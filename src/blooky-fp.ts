/**
 * blooky-fp.ts
 * 関数型リアクティブプログラミングをTypeScriptで行うためのライブラリ。
 */
import { 
  BlookyError, BlookyErrorCauseMap, CollapseObserver, CollapseReservation,
  DripEffect, DripperStream, DripStrategy, FilterStream, FlowingState,
  MappedStream, MergedStream, Prop, PropEffect, ShortDripStrategy, Stream, Vertex 
} from "./blooky-types";

/**
 * ガベージコレクション用クリーナー関数
 */
const STREAM_CLEANERS = new WeakMap<Stream<any>,()=>void>(); 
/**
 * Stream->Propの接続状況
 */
const STREAM_PROP_RELATIONS = new WeakMap<Stream<any>,Prop<any>[]>();
/**
 * Prop->Streamの逆参照
 */
const PROP_FROM = new WeakMap<Prop<any>, Stream<any>>();
/**
 * Propの値を更新する
 */
const PROP_UPDATE = new WeakMap<Prop<any>, ((v:any)=>void)>();

/**
 * ストリーム/プロパティのメモリを解放する。
 * @param s - クリアするStream
 * @param recursive - 接続されたStreamも再帰的にクリアするか（デフォルト: true）
 */
const clear = <A>(s: Stream<A>, recursive = true, visited = new WeakSet<Stream<any>>()) => {
    if (!isStream(s))
        throw new TypeError('clear requires Stream or Prop');
    if (visited.has(s))
        return;
    visited.add(s);
    if(recursive) {
        s.next.forEach((nextStream) => clear(nextStream, recursive, visited));
        s.lazyNext.forEach((nextStream) => clear(nextStream, recursive, visited));
    }
    if(STREAM_CLEANERS.has(s))
        STREAM_CLEANERS.get(s)!();
    s.next.clear();
    s.lazyNext.clear();
    if(STREAM_PROP_RELATIONS.has(s)) {
        STREAM_PROP_RELATIONS.get(s)!.forEach((p)=>{
            PROP_FROM.delete(p);
            PROP_UPDATE.delete(p);
        });
        STREAM_PROP_RELATIONS.delete(s);
    }
};

// GCにあわせて参照を解除する
const cleanupRegistry = 
    typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry<WeakRef<Stream<any>|Prop<any>>>((ref) => {
        const v = ref.deref();
        if(!v) return;
        if(typeof v === "function") {
            const from = PROP_FROM.get(v);
            if(!from) return;
            const arr = STREAM_PROP_RELATIONS.get(from)!;
            arr.splice(arr.indexOf(v), 1);
            if(!arr.length) STREAM_PROP_RELATIONS.delete(from);
            PROP_FROM.delete(v);
            PROP_UPDATE.delete(v);
        } else {
            clear(v, false);
        }
    })
    : {
        register(_: WeakKey, __: WeakRef<Stream<any>|Prop<any>>, ___?: WeakKey) {},
        unregister(_: WeakKey): boolean {return false}
    } as FinalizationRegistry<WeakRef<Stream<any>|Prop<any>>>;

// filter, when用の内部ヘルパー
type Predicate<A> = ((v:A)=>boolean)|RegExp|A;
const toPredicate = <A>(predicate: Predicate<A>) => 
    typeof predicate === "function"
    ? predicate as (v:A)=>boolean
    : predicate instanceof RegExp
    ? (v:A) => predicate.test(String(v))
    : (v:A) => v === predicate
;

/**
 * 値を流し込むための「入り口」となるDripperStreamを生成する。drip()とcollapse()を通じて実行できる。
 * @param strategy - 実行タイミングの制御（省略時はimmediate）
 * @returns 新しいDripper
 */
const stream = <A>(strategy: ShortDripStrategy|DripStrategy = { type: "immediate" }) : DripperStream<A> => {
    if(!("type" in strategy))
        return "throttle" in strategy
            ? stream({ type: "throttle", interval: strategy.throttle })
            : "debounce" in strategy
            ? stream({ type: "debounce", delay: strategy.debounce })
            : "lock" in strategy
            ? stream({ type: "lock", mode: strategy.lock })
            : stream({ type: "immediate" });
    const s: DripperStream<A> = {
        next: new Set(),
        lazyNext: new Set(),
        dripStrategy: strategy
    };
    cleanupRegistry.register(s, new WeakRef(s));
    return s;
};

/**
 * 複数のStreamを一つに合流させる。
 * いずれかのStreamに値が流れると、合流後のStreamにも値が流れる。
 * reduceFnで、複数の値をどう統合するかを指定できる。
 * @param streams - 合流させるStreamの配列
 * @param reduceFn - 値の統合方法（省略時は後の値で上書き）
 * @returns 合流後のStream
 */
const merge = <A> (s:Stream<A>[], f?:(a:A,b:A)=>A) : MergedStream<A> => {
    const _s : MergedStream<A> = {
        next: new Set(),
        lazyNext: new Set(),
        reduceFn: f || ((_,v) => v)
    };
    STREAM_CLEANERS.set(_s, () => {
        s.forEach((s)=>s.lazyNext.delete(_s));
    });
    s.forEach((s)=>s.lazyNext.add(_s));
    cleanupRegistry.register(_s, new WeakRef(_s));
    return _s;
};

/**
 * Streamから条件に合う値だけを通過させる。
 * @param predicate - フィルタ条件 / (v)=>boolean または RegExp または 一致を調べる値
 * @returns Streamを受け取りFilterStreamを返す関数
 */
const filter = <A>(f:Predicate<A>) => (s:Stream<A>) : FilterStream<A> => {
    const _s: FilterStream<A> = {
        filterFn: toPredicate(f),
        next: new Set(),
        lazyNext: new Set(),
    };
    s.next.add(_s);
    STREAM_CLEANERS.set(_s, () => s.next.delete(_s));
    cleanupRegistry.register(_s, new WeakRef(_s));
    return _s;
}

/**
 * Streamの値を別の値に変換する。
 * @param fn - 変換関数、Prop、または固定値
 * @returns Streamを受け取りMappedStreamを返す関数
 */
const map = <A,B>(f:((v:B)=>A)|Prop<A>|A) => (s:Stream<B>) : MappedStream<A> => {
    const _s: MappedStream<A> = {
        mapFn: typeof f === "function" ? f as <B>(v:B)=>A : () => f,
        next: new Set(),
        lazyNext: new Set()
    };
    s.next.add(_s);
    STREAM_CLEANERS.set(_s, () => s.next.delete(_s));
    cleanupRegistry.register(_s, new WeakRef(_s));
    return _s;
};

/**
 * Prop<A>の値に応じて、異なるStreamを選択的に合流させる。
 * @param records - { key: Stream } の形式のレコードまたはMap
 * @returns Propを受け取りMergedStreamを返す関数
 */
const junction = <A,B>(records: Map<A,Stream<B>>|Record<string|symbol|number,Stream<B>>) => {
    if(!(records instanceof Map)) return junction(new Map(Object.entries(records)));
    return (p:Prop<A>) : MergedStream<B> => {
        const streams = [...records.entries()].map(([k,s]:[A,Stream<B>])=>filter<B>(()=>p()===k)(s));
        const merged = merge<B>(streams);
        STREAM_CLEANERS.set(merged, () => streams.forEach((s)=>clear(s)));
        return merged;
    };
}

/**
 * Streamから値を蓄積し、累積値を保持するPropを生成する。
 * @param fn - 累積関数 (currentState, newValue) => nextState
 * @param initial - 初期状態
 * @returns Streamを受け取りPropを返す関数
 */
const accum = <S,A>(f:(s:S,v:A)=>S, s: S) => (_s:Stream<A>) : Prop<S> => {
    const p: Prop<S> = hold(s)(map((v:A)=>f(p(),v))(_s));
    return p;
}

/**
 * 関数を順次適用するパイプライン。Stream操作を読みやすく記述するためのユーティリティ。
 * @param value - 初期値
 * @param ops - 適用する関数の列
 * @returns 最終結果
 * @example
 * ```typescript
 * const result = pipe(
 *   stream<number>(),
 *   filter((n) => n > 0),
 *   map((n) => n * 2),
 *   hold(0)
 * );
 * ```
 */
function pipe<A,B>(value:A,op1:(a:A)=>B):B;
function pipe<A,B,C>(value:A,op1:(a:A)=>B,op2:(b:B)=>C):C;
function pipe<A,B,C,D>(value:A,op1:(a:A)=>B,op2:(b:B)=>C,op3:(c:C)=>D):D;
function pipe<A,B,C,D,E>(value:A,op1:(a:A)=>B,op2:(b:B)=>C,op3:(c:C)=>D,op4:(d:D)=>E):E;
function pipe<A,B,C,D,E,F>(value:A,op1:(a:A)=>B,op2:(b:B)=>C,op3:(c:C)=>D,op4:(d:D)=>E,op5:(e:E)=>F):F;
function pipe<A>(v:A,...fns:any[]) { return fns.reduce((v,f)=>f(v),v) }

/**
 * 値がStreamかどうかを判定。
 * @param v - 判定対象
 * @returns Streamならtrue
 */
const isStream = <A>(v:unknown) : v is Stream<A> => 
    v != null && typeof v === "object" && "next" in v && "lazyNext" in v;

/**
 * StreamがDripperかどうかを判定。
 * @param v - 判定対象
 * @returns Dripperならtrue
 */
const isDripperStream = <A>(v:unknown) : v is DripperStream<A> =>
    isStream<A>(v) && "dripStrategy" in v;

/**
 * PropがStreamから生成されたものかを判定。
 * @param v - 判定対象
 * @returns Streamと接続されたPropならtrue
 */
const isChainedProp = <A>(v: unknown): v is Prop<A> => PROP_UPDATE.has(v as Prop<A>);

/**
 * StreamをVertex（グラフ構造）として表現したオブジェクトか判定する。
 * @param v - 判定対象
 * @returns Vertexならtrue
 */
const isVertex = (v: unknown) : v is Vertex =>  v ? isStream((v as Vertex).sourceStream) : false;

// memo
const VERTEX_MAP = new WeakMap<Stream<any>,Vertex>();

/**
 * Streamをグラフ構造（Vertex）に変換する。データフローの可視化に使用。
 * @param s - 変換するStream
 * @returns グラフ構造
 */
const vertex = (s:Stream<any>): Vertex => {
    const buildVertex = (source:Stream<any>, from?: Vertex) => {
        if(VERTEX_MAP.has(source)) return VERTEX_MAP.get(source)!;
        const vert: Vertex = {
            sourceStream: source,
            from,
            props: STREAM_PROP_RELATIONS.get(source)
        };
        VERTEX_MAP.set(source, vert);
        if(source.next.size)
            vert.next = [...source.next].map((s)=>buildVertex(s,vert));
        if(source.lazyNext.size)
            vert.lazyNext = [...source.lazyNext].map((s)=>buildVertex(s,vert));
        return vert;
    }
    return buildVertex(s);
}

// 内部実装用の関数群
const streamToFlowingState = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const waiting = [...s.lazyNext].map((s) => [s,v] as [MergedStream<A>,A]);
    if(!STREAM_PROP_RELATIONS.has(s)) return [[], waiting];
    const p = STREAM_PROP_RELATIONS.get(s)!;
    const effect: PropEffect<A>[] = p.map((prop)=>([prop,v]));
    return [effect,waiting];
}

const concatTuple = <T extends any[][]>(a: T, b: T): T => a.map((x, i) => x.concat(b[i])) as T;

const flow = <A>(v:A, allowPromise: boolean) => (s:Stream<A>) : FlowingState => {
    if(v instanceof Promise && !allowPromise)
        throw new Error("Asynchronous function was used in a synchronous stream.");
    const state = streamToFlowingState(v)(s);
    const next = [...s.next].filter((s)=> !("filterFn" in s) || s.filterFn(v));
    return next.length
        ? next.map((_s) => flow("mapFn" in _s ? _s.mapFn(v) : v, allowPromise)(_s)).reduce(concatTuple, state)
        : state;
}

const flowLazy = <A>(v:A, allowPromise = false) => (s:Stream<A>) : FlowingState => {
    const r = flow(v, allowPromise)(s);
    const [updates,waiting] = r;
    if(!waiting.length) return r;
    const m = waiting.reduce((m,[s,v])=> {
        if(m.has(s))
            m.get(s)!.push(v);
        else
            m.set(s, [v]);
        return m;
    }, new Map<MergedStream<any>,any[]>());
    return [...m].map(([s,v])=>flowLazy(v.reduce(s.reduceFn))(s)).reduce(concatTuple, [updates,[]]);
}

/**
 * Dripperに値を流し込むための「効果(Effect)」を生成。値の更新は、この関数の結果を引数として collapse() を呼ぶことで生じる。
 * Data Flow:
 * ```
 * value + Dripper ──drip()──> DripEffect<A> ──collapse()──> 実行
 * ```
 * 
 * @param value - 流し込む値
 * @returns Dripperを受け取りDripEffect<A>を返す関数
 */
const drip = <A>(value:A) => (dripper:DripperStream<A>) : DripEffect<A> => ({
    dripper,
    value,
    effects: new Map(flowLazy(value, false)(dripper)[0])
});

/**
 * Streamから現在値を保持するPropを生成する。
 * @param initial - 初期値
 * @returns Streamを受け取りPropを返す関数
 */
const hold = <A>(v:A) => (s:Stream<A>): Prop<A> => {
    const p = () => v;
    PROP_UPDATE.set(p, (_v)=>v=_v);
    PROP_FROM.set(p, s);
    cleanupRegistry.register(p, new WeakRef(p));
    if(STREAM_PROP_RELATIONS.has(s))
        STREAM_PROP_RELATIONS.get(s)!.push(p);
    else
        STREAM_PROP_RELATIONS.set(s, [p]);
    return p;
}

/**
 * Propを別のPropに変換する。元のPropがStreamと接続されていれば、新しいPropも同じStreamから自動的に値を受け取る。
 * @param fn - 変換関数
 * @returns Propを受け取り新しいPropを返す関数
 */
const remap = <A,B>(f:(v:B,p?:B)=>A) => (p:Prop<B>) : Prop<A> => 
    PROP_FROM.has(p)
        ? hold(f(p()))(map(f)(PROP_FROM.get(p)!))
        : ()=>f(p());

/**
 * 複数のPropを組み合わせて新しいPropを生成。いずれかのPropが更新されると、新しいPropも自動的に再計算される。
 * @param fn - 統合関数
 * @returns Props配列を受け取り新しいPropを返す関数
 */
const lift = <A>(f: (values: any[]) => A) => (props: Prop<any>[]) : Prop<A> => {
  type reservation = [number, any];
  const valueFn = () => f(props.map(p => p()));
  const streams = props.flatMap((p, i) => PROP_FROM.has(p) ? map((v) => [[i, v]] as reservation[])(PROP_FROM.get(p)!) : []);
  const mergedStream = merge<[number,Stream<any>][]>(streams, (a, b) => a.concat(b));
  const transformed = map((updates: reservation[]) => {
    const map = new Map(updates);
    return f(props.map((p, i) => map.has(i) ? map.get(i)! : p()));
  })(mergedStream);
  STREAM_CLEANERS.set(transformed, () => {
    streams.forEach((s)=>clear(s));
  });
  return hold(valueFn())(transformed);
};

const NotThen = Symbol("NotThen");
type PromisedProp<T> = PromiseLike<T> & Prop<T|typeof NotThen>

/**
 * Propが特定の条件を満たすまで待機するPromiseLike Propを生成する。条件を満たすと自動的に解決される。
 * 条件を満たす度、thenを呼びなおせば新しいPromiseを取得できる。
 * @param predicate - 条件（関数、正規表現、または値）
 * @returns 条件を満たすまで待機するPromisedProp
 */
const when = <A>(predicate: Predicate<A>) => (p: Prop<A>): PromisedProp<A> => {
    const f = toPredicate(predicate);
    type ThenOrNotThen = A|typeof NotThen;
    let thenOrNotThen : ThenOrNotThen = f(p()) ? p() : NotThen;
    const _p = (()=>thenOrNotThen) as PromisedProp<A>;

    if(!PROP_FROM.has(p)) {
        const promise = thenOrNotThen !== NotThen
            ? Promise.resolve(thenOrNotThen as A)
            : new Promise<A>(()=>{});
        _p.then = promise.then.bind(promise);
        return _p;
    }
    
    const source = PROP_FROM.get(p)!;
    const _s = filter(f)(source);
    STREAM_PROP_RELATIONS.set(_s,[_p]);
    cleanupRegistry.register(_p,new WeakRef(_s));

    const resolvers: ((v:ThenOrNotThen)=>void)[] = [(v:ThenOrNotThen)=>thenOrNotThen=v];
    const callResolvers = (v:ThenOrNotThen) => {
        if(v !== NotThen) {
            resolvers.forEach((f)=>f(v));
            resolvers.length = 1;
        } else {
            resolvers[0](v);
        }
    };
    PROP_UPDATE.set(_p, callResolvers);
    _p.then = (f:(v:A)=>any) => new Promise<A>((r)=>resolvers.push(r as (v:ThenOrNotThen)=>void)).then(f);
    return _p;
};

/**
 * 既存オブジェクトのプロパティをblookyのデータフローと同期させる。
 * 返されたPropの更新は、元のオブジェクトのプロパティにも同期される。
 * @param obj - 対象オブジェクト
 * @param key - プロパティ名
 * @returns [Dripper, Prop]のタプル
 */
function proxy<T, K extends keyof T>(obj: T, key: K): [DripperStream<T[K]>, Prop<T[K]>] {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if(!desc)
    throw new Error(`Property "${String(key)}" does not exist.`);
  if(!desc.set && !desc.writable)
    throw new Error(`Property "${String(key)}" is not writable.`);

  const getter: Prop<T[K]> = () => desc.get ? desc.get.call(obj) : obj[key];
  const setter = desc.set
    ? desc.set.bind(obj)
    : (newValue: T[K]) => obj[key] = newValue;

  PROP_UPDATE.set(getter, setter);
  const dripper = stream<T[K]>();
  PROP_FROM.set(getter, dripper);
  STREAM_PROP_RELATIONS.set(dripper, [getter]);
  return [dripper, getter];
}

// --- 時間の源泉 ---
const beat$ = stream<number>();

/**
 * アプリケーション全体で共有される現在時刻を表すProp。
 * collapse()実行時に自動的に更新される。
 */
const clock: Prop<number> = hold(performance.now())(beat$);

// dobounce で一時保管するDrip情報
const PendingEffect = new WeakMap<DripperStream<any>,{
    pid: ReturnType<typeof setTimeout>
    resolvers: ((t:number)=>void)[]
}>();

// Throttleで処理中のドリッパーと時刻
const ThrottleRecord = new WeakMap<DripperStream<any>, {
    time: number
    resolvers: ((t:number)=>void)[]
}>();

// lock用の内部状態
const LockRecord = new WeakMap<DripperStream<any>, {
    locked: boolean
    queue: ((t:number)=>void)[]
    resolvers: ((t:number)=>void)[]
}>();

/**
 * DripEffectを実行する。blookyにおける「実行」の唯一のエントリーポイント。
 * drip()で生成したEffectは、collapse()を呼ぶまで実行されない。
 * 
 * Dripperのstrategyに応じて実行タイミングが制御される:
 * - immediate: 即座に実行
 * - debounce: 連続入力の最後だけ実行
 * - throttle: 一定間隔で間引いて実行
 * - lock: 実行中の新しいdripを制御
 *   - ignore: 実行中は無視
 *   - queue: 実行後にキューを順次処理
 *   - restart: 実行中を中断して新しい値で再開
 * @param effect - drip()で生成したDripEffect
 * @returns 実行完了時のタイムスタンプを返すPromise
 */
const collapse = async <A>(effect:DripEffect<A>) => new Promise<number>((resolve, reject) => {
    const dripper = effect.dripper;
    const strategy = dripper.dripStrategy;
    const now = performance.now();
    
    switch (strategy.type) {

        case 'immediate':
            tick({ now, effect, resolve, reject });
            break;

        case 'throttle':
            let lastRecord: { time: number, resolvers: ((n:number)=>void)[] }
            if(!ThrottleRecord.has(dripper)) {
                // 新しいスロット開始
                lastRecord = { time: now, resolvers: [resolve] };
                ThrottleRecord.set(dripper, lastRecord);
            } else {
                lastRecord = ThrottleRecord.get(dripper)!;
                lastRecord.resolvers.push(resolve);
                // クールタイム中なら実行待ちに溜めるだけでbreak
                if((now - lastRecord.time) < strategy.interval)  break;
                // でなければ前回がintervalより前なので継続
                lastRecord.time = now;
            }
            tick({
                now,
                effect,
                reject,
                resolve: (t:number) => {
                    lastRecord.resolvers.forEach((r)=>r(t));
                    lastRecord.resolvers.length = 0;
                }
            });
            break;

        case 'debounce':
            let pending: { pid: ReturnType<typeof setTimeout>, resolvers: ((t:number)=>void)[] };
            if(PendingEffect.has(dripper)) {
                pending = PendingEffect.get(dripper)!;
                pending.resolvers.push(resolve);
                clearTimeout(pending.pid);
            } else {
                pending = { pid: 0 as any, resolvers: [resolve] }
                PendingEffect.set(dripper, pending);
            }
            pending.pid = setTimeout(()=>{
                PendingEffect.delete(dripper);
                // timeout後のnowに切り替える
                tick({ now: performance.now(), effect, reject, resolve: (t:number) => pending.resolvers.forEach((r)=>r(t)) });
            }, strategy.delay);
            break;

        case 'lock':
            let record = LockRecord.get(dripper);
            if (!record) {
                record = { locked: false, queue: [], resolvers: [] };
                LockRecord.set(dripper, record);
            }

            if (record.locked) {
                switch (strategy.mode) {
                case 'ignore':
                    return;
                case 'queue':
                    record.queue.push((t:number) =>
                    tick({ now: t, effect, resolve, reject })
                    );
                    return;
                case 'restart':
                    // resolve/reject が複数呼ばれないよう、前の完了を伝達
                    record.resolvers.push(resolve);
                    break;
                }
            }

            record.locked = true;

            const releaseLock = (v: any) => {
                // resolve待ちをすべて通知
                record!.resolvers.forEach((f) => f(v));
                record!.resolvers.length = 0;
                record!.locked = false;

                // 次のキュー処理をスケジュール
                const next = record!.queue.shift();
                if (next) next(performance.now());
            };

            const wrappedResolve = (v: any) => {
                resolve(v);
                releaseLock(v);
            };

            const wrappedReject = (e: any) => {
                reject(e);
                releaseLock(e);
            };

            tick({ now, effect, resolve: wrappedResolve, reject: wrappedReject });
            break;
            
    }
});


// Effect処理のミドルウェア
const tickHandlers: { [key in CollapseObserver]: Set<(effect:DripEffect<any>)=>void> } = {
    immediate: new Set(),
    visual: new Set(),
    quantum: new Set(),
    sequential: new Set(),
    thrown: new Set()
}

/**
 * collapse実行時のオブザーバーを登録する。
 * 
 * オブザーバーの種類:
 * - immediate: 同期実行
 * - quantum: queueMicrotask
 * - visual: requestAnimationFrame
 * - sequential: setTimeout
 * - thrown: エラー時のみ
 * @param observer - オブザーバーの種類
 * @param handler - 実行されるハンドラ（DripEffect<any>を受け取る）
 * @returns 登録解除用の関数
*/
function registerCollapseObserver(observer: CollapseObserver, handler: (effect: DripEffect<any>) => void) {
  tickHandlers[observer].add(handler);
  return () => tickHandlers[observer].delete(handler);
}
// 予約されたEffectを処理する（内部実装）
function tick(reservation: CollapseReservation) {
    const now = reservation.now;
    if(now > clock() && reservation.effect.dripper !== beat$) {
        tick({ now, effect: drip(now)(beat$), resolve: ()=>{}, reject: ()=>{} });
    }
    
    const errors: BlookyError<keyof BlookyErrorCauseMap>[] = [];
    
    const observers: { [key in Exclude<CollapseObserver,"thrown">]: (f:()=>void)=>void } = {
        "immediate": (f)=>f(),
        "visual": globalThis.requestAnimationFrame || (globalThis as any).nextTick || (globalThis as any).setImmediate,
        "sequential": setTimeout,  
        "quantum": queueMicrotask
    };
    
    const promises: Promise<unknown>[] =
        Object.entries(observers).flatMap(([key,ticker])=> {
            const handlers = tickHandlers[key as CollapseObserver];
            return !handlers.size
                ? []
                : new Promise((resolve) => ticker(()=>{
                    const handlers = tickHandlers[key as CollapseObserver];
                    handlers.forEach((handler) => {
                        try {
                            handler(reservation.effect);
                        } catch(err) {
                            errors.push(err instanceof Error && 'category' in err 
                                ? err as BlookyError<any>
                                : blooky.error("user", {
                                    code: "TICK_HANDLER_ERROR",
                                    message: "Tick handler threw error",
                                    originalError: err,
                                    recoverable: true
                                }));
                        }
                    });
                    resolve(void 0);
                }));
        });
    
    Promise.allSettled(promises).then(()=>{
        if (errors.length && tickHandlers.thrown.size) {
            const errorEffects = errors.map(error => drip(error)(blooky.errorStream[error.category]));
            tickHandlers.thrown.forEach(handler => {
                try {
                    handler(errorEffects[0]);
                } catch (thrownError) {
                    console.error('Error in thrown handler:', thrownError);
                }
            });
        }
        reservation.effect.effects.forEach((v,p)=>PROP_UPDATE.get(p)!(v));
        if(errors.length)
            reservation.reject(errors);
        else
            reservation.resolve(now);
    });
}

/**
 * blooky全体で共有されるユーティリティとエラーストリーム。
 * エラーストリームは、blooky内部で発生したエラーをカテゴリ別に流すDripper。
 */
const blooky = {
    /**
     * カテゴリ別のエラーストリーム。アプリケーションでエラーハンドリングを行う際に使用。
     */
    errorStream : {
      'dev-config': stream<BlookyError<'dev-config'>>(),
      'structure': stream<BlookyError<'structure'>>(),
      'constraint': stream<BlookyError<'constraint'>>(),
      'flow': stream<BlookyError<'flow'>>(),
      'user': stream<BlookyError<'user'>>()
    } as { [key in keyof BlookyErrorCauseMap]: DripperStream<BlookyError<keyof BlookyErrorCauseMap>> },

    /**
     * 構造化されたエラーを生成します。
     * 
     * @param category - エラーカテゴリ
     * @param cause - エラー詳細
     * @returns BlookyError
     */
    error: <T extends keyof BlookyErrorCauseMap>(
        category: T,
        cause: {
            code: string
            message: string
        } & BlookyErrorCauseMap[T]
    ): BlookyError<T> => {
        return Object.assign(new Error(cause.message, { cause }), { category }) as BlookyError<T>;
    }
};

export {
    // Core
    drip, collapse, stream,
    // Stream operators
    merge, junction, map, filter,
    // Prop creators
    hold, accum, lift, remap, when,
    // Utilities
    proxy, pipe, clear, vertex,
    // Type guards
    isStream, isDripperStream as isDripper, isDripperStream, isChainedProp, isVertex,
    // Observers
    registerCollapseObserver,
    // Shared
    clock, blooky,
    // Symbol
    NotThen
};

export type {
    PromisedProp,
    Stream, Prop, DripperStream as Dripper, DripEffect
};