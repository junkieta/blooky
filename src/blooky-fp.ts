/**
 * blooky-fp.ts
 * 関数型のリアクティブプログラミングをtypescriptで行うためのライブラリ。
 */
import { BlookyError, BlookyErrorCauseMap, CollapseObserver, CollapseReservation, DevConfigErrorCause, DripEffect, DripperStream, DripStrategy, FilterStream, FlowingState, MappedStream, MergedStream, Prop, PropEffect, ShortDripStrategy, Stream, Vertex } from "./blooky-types";

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
 * ストリーム/プロパティのメモリを解放する。ガベージコレクトの補助。
 * @param s 
 */
const clear = <A>(s: Stream<A>, recursive = true, visited = new WeakSet<Stream<any>>()) => {
    if (!isStream(s))
        throw new TypeError('clear requires Stream or Prop');
    if (visited.has(s))
        return; // 既に訪問済み
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
        console.log("[blooky] Stream auto-cleared by GC");
    })
    /**
     * ES2021～でしか使えないので、一応ダミーで対応
     * (GC補助用途だけなので、ダミー呼び出しに置き換えてもプログラム自体に影響することはない)
     */
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
 * ストリーム状態を生成する。
 */
const stream = <A>(strategy: ShortDripStrategy|DripStrategy = { type: "immediate" }) : DripperStream<A> => {
    const listener = strategy.listener;
    if(!("type" in strategy))
        return "throttle" in strategy
            ? stream({ type: "throttle", interval: strategy.throttle, listener })
            : "debounce" in strategy
            ? stream({ type: "debounce", delay: strategy.debounce, listener })
            : stream({ type: "immediate", listener: typeof strategy.immediate === "function" ? strategy.immediate : listener });
    const s: DripperStream<A> = {
        next: new Set(),
        lazyNext: new Set(),
        dripStrategy: strategy
    };
    // StreamがGCされたら自動clear
    cleanupRegistry.register(s, new WeakRef(s));
    return s;
};


/**
 * 二つ以上のイベントストリームを一つにまとめる
 * @param s 
 * @returns 
 */
const merge = <A> (s:Stream<A>[], f?:(a:A,b:A)=>A) : MergedStream<A> => {
    // マージ後のストリーム
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
 * イベントストリームから条件に合う値だけを取り出すストリームを生成する
 * @param s 
 * @returns 
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
 * ストリームを別の流れに変換する
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
 * { B: Stream<A> }形式のレコードから、Prop<B>の値に応じたStreamの値を通す、条件付きMergedStreamを生成する
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
 * イベントストリームから一つの値を計算する
 */
const accum = <S,A>(f:(s:S,v:A)=>S, s: S) => (_s:Stream<A>) : Prop<S> => {
    const p: Prop<S> = hold(s)(map((v:A)=>f(p(),v))(_s));
    return p;
}

// パイプライン的な書き方
// pipe(stream(),map(),filter(),...)等
function pipe<A,B>(value:A,op1:(a:A)=>B):B;
function pipe<A,B,C>(value:A,op1:(a:A)=>B,op2:(b:B)=>C):C;
function pipe<A,B,C,D>(value:A,op1:(a:A)=>B,op2:(b:B)=>C,op3:(c:C)=>D):D;
function pipe<A,B,C,D,E>(value:A,op1:(a:A)=>B,op2:(b:B)=>C,op3:(c:C)=>D,op4:(d:D)=>E):E;
function pipe<A,B,C,D,E,F>(value:A,op1:(a:A)=>B,op2:(b:B)=>C,op3:(c:C)=>D,op4:(d:D)=>E,op5:(e:E)=>F):F;
function pipe<A>(v:A,...fns:any[]) { return fns.reduce((v,f)=>f(v),v) }

/**
 * 引数がストリームであるかを判別する。
 */
const isStream = <A>(v:unknown) : v is Stream<A> => 
    v != null && typeof v === "object" && "next" in v && "lazyNext" in v;

/**
 * 引数がドリッパーであるかを判別する。
 */
const isDripperStream = <A>(v:unknown) : v is DripperStream<A> =>
    isStream<A>(v) && "dripStrategy" in v;

// 引数がStreamから接続されたPropか判別する
const isChainedProp = <A>(v: unknown): v is Prop<A> => PROP_UPDATE.has(v as Prop<A>);

const isVertex = (v: unknown) : v is Vertex =>  v ? isStream((v as Vertex).sourceStream) : false;

// memo
const VERTEX_MAP = new WeakMap<Stream<any>,Vertex>();
// 各Streamを頂点として、WeakMapから関連する値を接続したグラフを生成する
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


/**
 * 受け取った時変値でフロー状態を作成する
 * @param v 
 * @returns 
 */
const streamToFlowingState = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const waiting = [...s.lazyNext].map((s) => [s,v] as [MergedStream<A>,A]);
    if(!STREAM_PROP_RELATIONS.has(s)) return [[], waiting];
    const p = STREAM_PROP_RELATIONS.get(s)!;
    const effect: PropEffect<A>[] = p.map((prop)=>([prop,v]));
    return [effect,waiting];
}

const concatTuple = <T extends any[][]>(a: T, b: T): T => a.map((x, i) => x.concat(b[i])) as T;

/**
 * 時変値を受け取って指定のストリームからフローを開始、開始されたフロー状態を返す。
 * @param v 
 * @returns 
 */
const flow = <A>(v:A, allowPromise: boolean) => (s:Stream<A>) : FlowingState => {
    if(v instanceof Promise && !allowPromise)
        // 同期フローのPromiseは明示的に許可されなければエラーを投げる
        throw new Error("Asynchronous function was used in a synchronous stream. Check DripOption.acceptPromise to execute this flow.");
    const state = streamToFlowingState(v)(s);
    const next = [...s.next].filter((s)=> !("filterFn" in s) || s.filterFn(v));
    return next.length
        ? next.map((_s) => flow("mapFn" in _s ? _s.mapFn(v) : v, allowPromise)(_s)).reduce(concatTuple, state)
        : state;
}

/**
 * マージ予定ストリームの遅延処理を施したフロー関数。
 * @param v 
 * @returns 
 */
const flowLazy = <A>(v:A, allowPromise = false) => (s:Stream<A>) : FlowingState => {
    const r = flow(v, allowPromise)(s);
    const [updates,waiting] = r;
    // マージされたストリームとはつながっていない
    if(!waiting.length) return r;
    // マージされたストリーム毎に、到着した値をリスト化する
    const m = waiting.reduce((m,[s,v])=> {
        if(m.has(s))
            m.get(s)!.push(v);
        else
            m.set(s, [v]);
        return m;
    }, new Map<MergedStream<any>,any[]>());
    // ストリーム毎のreducerを呼んだ上で通常のstreamとしてflowする
    return [...m].map(([s,v])=>flowLazy(v.reduce(s.reduceFn))(s)).reduce(concatTuple, [updates,[]]);
}

/**
 * 起点となるストリームに時変値を流し込み、関連する時変値で構成されたEffectを返す。
 * @param s 
 * @returns 
 */
const drip = <A>(value:A, options?: { acceptPromise: boolean }) => (dripper:DripperStream<A>) : DripEffect<A> => ({
    dripper,
    value,
    effects: new Map(flowLazy(value, options && options.acceptPromise === true)(dripper)[0])
});


/**
 * イベントストリームからプロパティを作る
 * @param s 
 * @returns 
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
 * プロパティを別プロパティに変換する
 */
const remap = <A,B>(f:(v:B,p?:B)=>A) => (p:Prop<B>) : Prop<A> => 
    PROP_FROM.has(p)
        ? hold(f(p()))(map(f)(PROP_FROM.get(p)!))
        : ()=>f(p());

/**
 * 時変値に関数を適用して新しい時変値を作る
 * @param c 
 * @returns 
 */
const lift = <A>(f: (values: any[]) => A) => (props: Prop<any>[]) : Prop<A> => {
  type reservation = [number, any];
  const valueFn = () => f(props.map(p => p()));
  // Streamを持っているPropだけを集める
  const streams: Stream<reservation[]>[] = props.flatMap((p, i) => PROP_FROM.has(p) ? map((v) => [[i, v]] as reservation[])(PROP_FROM.get(p)!) : []);
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

// 未解決の値を示すSymbol。PromisedProp用。
const NotThen = Symbol("NotThen");
/**
 * 観測予約可能なProp
 * 
 * thenは通常のPromiseと異なり：
 * - 条件を満たす度に新しい値で解決される
 * - 「次回の観測結果の予約」という意味
 * - 一度解決されても、再度thenを呼べば新たな予約が可能
 */
type PromisedProp<T> = PromiseLike<T> & Prop<T|typeof NotThen>

/**
 * PromisedPropを生成する。filter同様、predicateに値そのものやRegExpを渡すことができる
 */
const when = <A>(predicate: Predicate<A>) => (p: Prop<A>): PromisedProp<A> => {
    const f = toPredicate(predicate);
    type ThenOrNotThen = A|typeof NotThen;
    let thenOrNotThen : ThenOrNotThen = f(p()) ? p() : NotThen;
    const _p = (()=>thenOrNotThen) as PromisedProp<A>;

    // データフローに接続されていない関数だった場合
    if(!PROP_FROM.has(p)) {
        const promise = thenOrNotThen !== NotThen
            // 条件を既に満たしている場合：即時解決するPromiseをセット
            ? Promise.resolve(thenOrNotThen as A)
            // 条件を満たしておらず、今後も満たすことがない場合：永遠に待機するPromiseをセット
            : new Promise<A>(()=>{});
        // thenを生成したPromiseに結び付けて代入
        _p.then = promise.then.bind(promise);
        return _p;
    }
    
    // holdとは違う経路でPropを生成しているので、ここでもgc用設定を入れる
    const source = PROP_FROM.get(p)!;
    const _s = filter(f)(source);
    STREAM_PROP_RELATIONS.set(_s,[_p]);
    cleanupRegistry.register(_p,new WeakRef(_s));

    // 0番目は、本来のPropのアップデータで、以降はthenから受け取ったresolverを格納する。
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
 * 既存オブジェクトのプロパティと同期するStream/Propを生成する。
 * このPropがblookyのデータフローによって更新されることは元のオブジェクトのプロパティの更新とイコール。
 * @param obj 対象オブジェクト
 * @param key プロパティ名
 */
function proxy<T, K extends keyof T>(obj: T, key: K): [DripperStream<T[K]>, Prop<T[K]>] {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if(!desc)
    throw new Error(`Property "${String(key)}" does not exist.`);
  if(!desc.set && !desc.writable)
    throw new Error(`Property "${String(key)}" is not writable.`);

  // 1. このgetter関数が、新しいPropそのものになる。
  const getter: Prop<T[K]> = () => desc.get ? desc.get.call(obj) : obj[key];
  // 2. このPropが更新されるべき時に呼ばれるsetterを定義する。
  const setter = desc.set
    // 元のsetterがあれば、それを正しい`this`で呼び出す
    ? desc.set.bind(obj)
    // valueプロパティなら、直接代入する
    : (newValue: T[K]) => obj[key] = newValue;

  // 3. blookyのコアに、Propとその更新関数を直接登録する
  PROP_UPDATE.set(getter, setter);
  const dripper = stream<T[K]>();
  PROP_FROM.set(getter, dripper);
  STREAM_PROP_RELATIONS.set(dripper, [getter]);
  return [dripper, getter];
}


// --- 時間の源泉 ---
const beat$ = stream<number>();

// アプリケーション全体で共有される、現在の時間を表すProp。
const clock: Prop<number> = hold(0)(beat$);

// dobounce で一時保管するDrip情報
const PendingEffect = new WeakMap<DripperStream<any>,{
    pid: ReturnType<typeof setTimeout>
    resolvers: ((v:number)=>void)[]
}>();

// Throttleで処理中のドリッパーと時刻
const ThrottleRecord = new WeakMap<DripperStream<any>, {
    time: number
    resolvers: ((v:number)=>void)[]
}>();

// effectの実行スケジュールを組む。
// dripのstrategyで実行タイミングを調節し、実行処理はtickに投げる
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

// ミドルウェアの登録用関数
function registerCollapseObserver(observer: CollapseObserver, handler: <A>(effect: DripEffect<A>) => void) {
  tickHandlers[observer].add(handler);
  return () => tickHandlers[observer].delete(handler);
}

// 予約されたEffectを処理する
// tickハンドラをそれぞれのobserverに合わせて全て呼び出した後、Propを更新する。
function tick(reservation: CollapseReservation) {
    const now = reservation.now;
    // clockが未更新であれば先に実行する
    if(now > clock() && reservation.effect.dripper !== beat$) {
        tick({ now, effect: drip(now)(beat$), resolve: ()=>{}, reject: ()=>{} });
    }
    // ハンドラー呼び出し中のエラーを格納
    const errors: BlookyError<keyof BlookyErrorCauseMap>[] = [];
    // collapse開始のリスナーを呼び出す(同期処理のフェーズ)
    try {
        reservation.effect.dripper.dripStrategy.listener?.(reservation.effect.value);
    } catch(err) {
        errors.push(err instanceof Error && 'category' in err 
            ? err as BlookyError<any>
            : blooky.error("user", {
                code: "TICK_LISTENER_ERROR", 
                message: "dripStrategy:listener threw error",
                originalError: err,
                recoverable: true
            }));
    }

    // thrownを除くオブザーバーのハンドラ呼び出し用関数
    const observers: { [key in Exclude<CollapseObserver,"thrown">]: (f:()=>void)=>void } = {
        "immediate": (f)=>f(),
        "visual": globalThis.requestAnimationFrame || (globalThis as any).nextTick || (globalThis as any).setImmediate,
        "sequential": setTimeout,   
        "quantum": queueMicrotask
    };

    // 各オブザーバーの呼び出し予約をし、その完了待ちPromiseを集める
    const promises: Promise<unknown>[] = 
        Object.entries(observers).flatMap(([key,ticker])=> {
            const handlers = tickHandlers[key as CollapseObserver];
            return !handlers.size
                ? []
                : new Promise((resolve) => ticker(()=>{
                    const handlers = tickHandlers[key as CollapseObserver];
                    handlers.forEach((handler) => {
                        const err = handleCollapse(reservation.effect)(handler);
                        if(err instanceof Error) errors.push(err);
                    });
                    resolve(void 0);
                }));
        });

    Promise.allSettled(promises).then(()=>{
        // エラーがあればthrown observerに送信
        if (errors.length && tickHandlers.thrown.size) {
            const errorEffects = errors.map(error => drip(error)(blooky.errorStream[error.category]));
            tickHandlers.thrown.forEach(handler => {
                try {
                    errorEffects.forEach((errEffect)=>handler(errEffect));
                } catch (thrownError) {
                    console.error('Error in thrown handler:', thrownError);
                }
            });
        }
        // ハンドラの処理が完了したら、PropEffectの更新を処理する
        reservation.effect.effects.forEach((v,p)=>PROP_UPDATE.get(p)!(v));
        // collapse全体の完了通知
        if(errors.length)
            reservation.reject(errors);
        else
            reservation.resolve(now);
    });

}

// collapseハンドラーの呼び出しとエラー処理
const handleCollapse = (effect: DripEffect<any>) => (handler: (e:DripEffect<any>)=>void) : BlookyError<keyof BlookyErrorCauseMap>|0 => {
    try {
        handler(effect);
    } catch(err) {
        return err instanceof Error && 'category' in err 
            ? err as BlookyError<any>
            : blooky.error("user", {
                code: "TICK_HANDLER_ERROR", 
                message: "Tick handler threw error",
                originalError: err,
                recoverable: true
            });
    }
    return 0;
};


// 全モジュール共通ユーティリティ。
const blooky = {

    errorStream : {
      'dev-config': stream<BlookyError<'dev-config'>>(),
      'structure': stream<BlookyError<'structure'>>(),
      'constraint': stream<BlookyError<'constraint'>>(),
      'flow': stream<BlookyError<'flow'>>(),
      'user': stream<BlookyError<'user'>>()
    } as { [key in keyof BlookyErrorCauseMap]: DripperStream<BlookyError<keyof BlookyErrorCauseMap>> },

    // エラーの生成。javascriptネイティブのErrorを拡張する
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
    drip,stream,vertex,
    isStream,isDripperStream as isDripper,isDripperStream,isChainedProp,isVertex,
    clear,
    merge,junction,map,filter,
    hold,accum,lift,remap,when,NotThen,
    proxy,
    pipe,
    clock,collapse,registerCollapseObserver,
    blooky
};

export type {
    PromisedProp,
};

