/**
 * blooky.ts
 * 関数型のリアクティブプログラミングをtypescriptで行うためのライブラリ。
 */

import { DripperEffect, DripResult, PropEffect } from "./blooky-types";

// ガベージコレクタの格納プロパティ用シンボル
const STREAM_CLEANER = Symbol("STREAM_CLEANER");

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
const PROP_UPDATE = new WeakMap<Prop<any>, ((v:any)=>void)|((next:any,prev:any)=>void)>();

/**
 * ストリームの状態定義。次のストリームへの接続用情報を保持する。
 */
type StreamBase<A,T> = {
    /**
     * ガベージコレクション
     * @returns 
     */
    [STREAM_CLEANER]?: ()=>void
    /**
     * 連結されたストリーム
     */
    next: Set<MappedStream<any,A>|FilterStream<A>>
    /**
     * 連結先のうち、マージされる可能性のあるストリーム
     */
    lazyNext: Set<MergedStream<A>>
} & T;

const IS_DRIPPER = Symbol("IS_DRIPPER");

type DripperStream<A> = StreamBase<A, {
    [IS_DRIPPER]: typeof IS_DRIPPER
}>
type MergedStream<A> = StreamBase<A,{
    reduceFn: (a:A,b:A)=>A
}>
type MappedStream<A,B=any> = StreamBase<A, {
    mapFn: (v:B)=>A|Promise<A>
}>;
type FilterStream<A> = StreamBase<A,{ 
    /**
     * フィルタ。受け入れられる値かを判断する。
     * @param v 
     * @returns 
     */
    filterFn: (v:A)=>boolean 
}>

type Stream<A> = 
   | DripperStream<A>
   | MappedStream<A>
   | MergedStream<A>
   | FilterStream<A>

/**
 * 連結したストリームを辿り、受け取った時変値の処理関数をまとめる
 */
type FlowingState = [PropEffect<unknown>[], [MergedStream<any>,any][]];


/**
 * 時変値を返す関数の型。
 */
type Prop<A> = ()=>A;

/**
 * ストリーム/プロパティのメモリを解放する。ガベージコレクトの補助。
 * @param s 
 */
const clear = <A>(s: Stream<A>, recursive = true, visited = new WeakSet<Stream<any>>()) => {
    if (!isStream(s)) {
        throw new TypeError('clear requires Stream or Prop');
    } else if (visited.has(s)) {
        return; // 既に訪問済み
    } else {
        visited.add(s);
        if(recursive) {
            s.next.forEach((nextStream) => clear(nextStream, recursive, visited));
            s.lazyNext.forEach((nextStream) => clear(nextStream, recursive, visited));
        }
        if (s[STREAM_CLEANER]) s[STREAM_CLEANER]();
        s.next.clear();
        s.lazyNext.clear();
        if(STREAM_PROP_RELATIONS.has(s)) {
            STREAM_PROP_RELATIONS.get(s)!.forEach((p)=>{
                PROP_FROM.delete(p);
                PROP_UPDATE.delete(p);
            });
            STREAM_PROP_RELATIONS.delete(s);
        }
    }
};

// GCにあわせて参照を解除する
const cleanupRegistry = 
    window.FinalizationRegistry
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

/**
 * ストリーム状態を生成する。
 */
const stream = <A>() => {
    const s: DripperStream<A> = {
        next: new Set(),
        lazyNext: new Set(),
        [IS_DRIPPER]: IS_DRIPPER
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
const merge = <A> (f?:(a:A,b:A)=>A) => (s:Stream<A>[]) : MergedStream<A> => {
    // マージ後のストリーム
    const _s : MergedStream<A> = {
        next: new Set(),
        lazyNext: new Set(),
        reduceFn: f || ((_,v) => v),
        [STREAM_CLEANER]: () => {
            s.forEach((s)=>s.lazyNext.delete(_s));
        }
    };
    s.forEach((s)=>s.lazyNext.add(_s));
    cleanupRegistry.register(_s, new WeakRef(_s));
    return _s;
};

/**
 * イベントストリームから条件に合う値だけを取り出すストリームを生成する
 * @param s 
 * @returns 
 */
const filter = <A>(f:((v:A)=>boolean)|RegExp|A) => typeof f !== "function"
    ? (filter(f instanceof RegExp ? (v:A)=>f.test(String(v)) : (v:A) => v === f))
    : (s:Stream<A>) : FilterStream<A> => {
        const _s: FilterStream<A> = {
            filterFn: f as (v:A)=>boolean,
            next: new Set(),
            lazyNext: new Set(),
        };
        s.next.add(_s);
        _s[STREAM_CLEANER] = () => s.next.delete(_s);
        cleanupRegistry.register(_s, new WeakRef(_s));
        return _s;
    }

/**
 * ストリームを別の流れに変換する
 */
const map = <A,B>(f:((v:B)=>A)|Prop<A>|A): ((s:Stream<B>)=>MappedStream<A,B>) =>
    typeof f !== "function"
    ? map<A,B>(() => f)
    : (s:Stream<B>) : MappedStream<A,B> => {
        const _s: MappedStream<A,B> = {
            mapFn: f as (v:B)=>A,
            next: new Set(),
            lazyNext: new Set()
        };
        s.next.add(_s);
        _s[STREAM_CLEANER] = () => s.next.delete(_s);
        cleanupRegistry.register(_s, new WeakRef(_s));
        return _s;
    };

const junction = <A,B>(records: Map<B,Stream<A>>|Record<string,Stream<A>>) => {
    if(!(records instanceof Map)) return junction(new Map(Object.entries(records)));
    return (p:Prop<B>) => {
        const streams = [...records.entries()].map(([k,s]:[B,Stream<A>])=>filter(()=>p()===k)(s));
        const merged = merge()(streams);
        merged[STREAM_CLEANER] = () => streams.forEach((s)=>clear(s));
        return merged;
    };
}
    

/**
 * イベントストリームから一つの値を計算する
 */
const accum = <S,A>(f:(v:A,s:S)=>S, s: S) => (_s:Stream<A>) : Prop<S> => {
    const p: Prop<S> = hold(s)(map((v:A)=>f(v,p()))(_s));
    return p;
}


/**
 * 引数がストリームであるかを判別する。
 * @param v 
 * @returns 
 */
const isStream = <A>(v:unknown) : v is Stream<A> => 
    v != null && typeof v === "object" && "next" in v && "lazyNext" in v;

/**
 * 引数がドリッパーであるかを判別する。
 * @param v 
 * @returns 
 */
const isDripperStream = <A>(v:unknown) : v is DripperStream<A> =>
    isStream<A>(v) && v[IS_DRIPPER] === IS_DRIPPER;

function isChainedProp<A>(v: unknown): v is Prop<A> {
  return PROP_UPDATE.has(v as Prop<A>);
}


/**
 * ストリームがオブザーバかプロパティによってどれだけ参照されているかを調べる
 * @param s 
 * @returns 
 */
const countReferences = (s: Stream<any>, deep = false): Prop<number> => {
  if (!isStream(s)) throw new TypeError("countReferences requires Stream");
  const count = (s: Stream<any>) => STREAM_PROP_RELATIONS.has(s) ? STREAM_PROP_RELATIONS.get(s)!.length : 0;
  const count_deep = (s: Stream<any>, visited: WeakSet<Stream<any>>): number => {
    if(visited.has(s)) return 0;
    visited.add(s);
    return [...s.next, ...s.lazyNext].reduce((acc, child) => acc + count_deep(child, visited), count(s));
  };
  return deep === true
    ? () => count_deep(s, new WeakSet())
    : () => count(s);
};


/**
 * ストリームに一定以上の参照が残っているか判定
 * @param s      対象ストリーム
 * @param than   閾値 (デフォルト0 = 1つでも参照があればtrue)
 */
const hasReferences = (s: Stream<any>, than = 0): boolean => {
    const visited = new WeakSet<Stream<any>>();
    const stack: Stream<any>[] = [s];
    let count = 0;
    while (stack.length) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if(!STREAM_PROP_RELATIONS.has(current)) continue;
        const o = STREAM_PROP_RELATIONS.get(current)!;
        if (o.length) count += o.length;
        if (count > than) return true;
        stack.push(...current.next, ...current.lazyNext);
    }
    return false;
};

/**
 * 受け取った時変値でフロー状態を作成する
 * @param v 
 * @returns 
 */
const streamToFlowingState = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const waiting = [...s.lazyNext].map((s) => [s,v] as [MergedStream<A>,A]);
    if(!STREAM_PROP_RELATIONS.has(s)) return [[], waiting];
    const p = STREAM_PROP_RELATIONS.get(s)!;
    const effect: DripperEffect = p.map((prop)=>({
        prop,
        created: Date.now(),
        nextValue: v,
        prevValue: prop(),
        update: PROP_UPDATE.get(prop)!.bind(null, v)
    }));
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

// 戻り値の型を定義
type AsyncFlowState = {
  effects: DripperEffect,
  waiting: [MergedStream<any>, any][]
};

/**
 * 【内部用】非同期でグラフを走査し、Effectと待機リストを収集する
 */
const collectFlowStateAsync = async <A>(v: A, s: Stream<A>): Promise<AsyncFlowState> => {
  // streamToFlowingStateは同期的
  const [initialEffects, initialWaiting] = streamToFlowingState(v)(s);
  
  const finalEffects = [...initialEffects];
  const finalWaiting = [...initialWaiting];

  // s.next を非同期で処理
  for (const child of s.next) {
    if ("filterFn" in child && !child.filterFn(v)) continue;
    
    let nextValue: any = v;
    if ("mapFn" in child) {
      const result = child.mapFn(v);
      nextValue = result instanceof Promise ? await result : result;
    }
    
    // 再帰的に収集
    const { effects, waiting } = await collectFlowStateAsync(nextValue, child);
    finalEffects.push(...effects);
    finalWaiting.push(...waiting);
  }

  // s.lazyNext はここでは処理せず、そのまま待機リストに追加
  for (const child of s.lazyNext) {
    finalWaiting.push([child, v]);
  }

  return { effects: finalEffects, waiting: finalWaiting };
};

/**
 * 非同期版のflow。AsyncMappedStreamとlazyNextを処理できる。
 */
async function* flowAsync<A>(v: A, s: Stream<A>): AsyncGenerator<PropEffect<unknown>> {
  // --- フェーズ0：Promiseは即await 
  if(v instanceof Promise) return flowAsync(await v, s);

  // --- フェーズ1：収集 ---
  // ヘルパーを呼び出し、グラフ全体の実行計画を一度に収集する
  const { effects, waiting } = await collectFlowStateAsync(v, s);

  // --- フェーズ2：実行と遅延処理 ---
  // 1. まず、直接の副作用（Propの更新）を全てyieldする
  for (const effect of effects) {
    yield effect;
  }
  // 2. lazyNextの処理を行う
  if (waiting.length === 0) {
    return; // 遅延処理がなければ終了
  }
  // 2a. 待機リストを、合流先のMergedStreamごとにグループ化する
  const waitingMap = waiting.reduce((map, [stream, value]) => {
    map.set(stream, (map.get(stream) || []).concat(value));
    return map;
  }, new Map<MergedStream<any>, any[]>());

  // 2b. グループごとにreducerを適用し、flowAsyncを再帰的に呼び出す
  for (const [mergedStream, values] of waitingMap.entries()) {
    if (values.length > 0) {
      const reducedValue = values.reduce(mergedStream.reduceFn);
      // 解決した値で、再びflowAsyncの実行を委譲する
      yield* flowAsync(reducedValue, mergedStream);
    }
  }
}


/**
 * 起点となるストリームに時変値を流し込み、関連するオブザーバの呼び出しと時変値で構成されたEffectを返す。
 * @param s 
 * @returns 
 */
function drip<
  A,
  M extends 'deny' | 'allow' | 'await' = 'deny' // モードをジェネリック型Mとして定義
>(value:A, options?: { acceptPromise?: M }) : (d:DripperStream<A>)=>DripResult<A,M> {
    // デフォルトは最も安全な 'deny'
    const mode = options?.acceptPromise ?? 'deny';
    return (mode === 'await'
        // "await"モードの場合は、非同期エンジンを呼び出し、Promise<Effect>を返す
        ? (dripper:DripperStream<A>) => dripAsync(value)(dripper)
        // "deny" または "allow" の場合は、同期的エンジンを呼び出し、Effectを返す
        : (dripper:DripperStream<A>) => dripSync(value, mode === 'allow')(dripper)
    ) as (d:DripperStream<A>) => DripResult<A,M>;
}

/**
 * 同期的なdrip。最速だが、Promiseの扱いに注意。
 */
const dripSync = <A>(value:A, allowPromise = false) => (dripper:DripperStream<A>) => ({
    trigger: { value, dripper },
    effects : flowLazy(value, allowPromise)(dripper)[0],
});

/**
 * 非同期版のdrip。flowAsyncを呼び出し、EffectのPromiseを返す。
 */
const dripAsync = <A>(value: A) => async (dripper: DripperStream<A>) => {
  const effects: DripperEffect = [];
  // for await...of で非同期ジェネレータを処理する
  for await (const effect of flowAsync(value, dripper)) {
    effects.push(effect);
  }
  return { trigger: { value, dripper }, effects, };
};

/**
 * エンハンサーの登録用Set
 */
const EFFECT_ENHANCERS = new Set<(e:DripperEffect)=>DripperEffect>();

/**
 * サブモジュールからEffectの生成をupgradeするためのエンハンサー登録/登録解除関数。
 */
drip.registerEnhancer = (f:(e:DripperEffect)=>DripperEffect) => {
    EFFECT_ENHANCERS.add(f);
};
drip.unregisterEnhancer = (f:(e:DripperEffect)=>DripperEffect) => {
    EFFECT_ENHANCERS.delete(f);
};

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
  const streams = props.flatMap((p, i) => PROP_FROM.has(p) ? map((v) => [[i, v]] as reservation[])(PROP_FROM.get(p)!) : []);
  const mergedStream = merge<reservation[]>((a, b) => a.concat(b))(streams);
  const transformed = map((updates: reservation[]) => {
    const map = new Map(updates);
    return f(props.map((p, i) => map.has(i) ? map.get(i)! : p()));
  })(mergedStream);
  transformed[STREAM_CLEANER] = () => {
    streams.forEach((s)=>clear(s));
  };
  return hold(valueFn())(transformed);
};

const NotThen = Symbol("NotThen");
interface PromisedProp<T> extends PromiseLike<T> {
    () : T|typeof NotThen
};

const when = <A>(predicate: (v: A) => boolean) => (p: Prop<A>): PromisedProp<A> => {
    // 1. まず現在の値で条件をチェックする
    const current = p();
    if (predicate(current))
        return Object.assign(()=>current, { then(onfulfilled) { onfulfilled!(current) } } as PromiseLike<A>);
    // 2. Propの源流となるStreamを`PROP_FROM`から取得
    const source = PROP_FROM.get(p);
    if (!source) return Object.assign(()=>NotThen, { then(){} } as PromiseLike<A>); 
    // 3. 解決されうるPromisedPropを生成する
    let thenOrNotThen : A|typeof NotThen = NotThen;
    const _s = filter(predicate)(source);
    const _p = (()=>thenOrNotThen) as PromisedProp<A>;
    STREAM_PROP_RELATIONS.set(_s,[_p]);
    cleanupRegistry.register(_p,new WeakRef(_p));
    const promise = new Promise<A>((resolve)=>PROP_UPDATE.set(_p,(_v)=>resolve(thenOrNotThen=_v)));
    promise.then(()=>clear(_s));
    _p.then = promise.then.bind(promise);
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
  if (!desc) {
    throw new Error(`Property "${String(key)}" does not exist.`);
  }
  // 1. このgetter関数が、新しいPropそのものになる。
  const getter: Prop<T[K]> = () => desc.get ? desc.get.call(obj) : obj[key];
  // 2. このPropが更新されるべき時に呼ばれるsetterを定義する。
  const setter = (newValue: T[K]) => {
    if (desc.set) {
      // 元のsetterがあれば、それを正しい`this`で呼び出す
      desc.set.call(obj, newValue);
    } else if ('value' in desc) {
      // valueプロパティなら、直接代入する
      obj[key] = newValue;
    }
  };
  // 3. blookyのコアに、Propとその更新関数を直接登録する
  PROP_UPDATE.set(getter, setter);
  const dripper = stream<T[K]>();
  PROP_FROM.set(getter, dripper);
  return [dripper, getter];
}

/**
 * momentsで渡される状態変数。
 */
type MomentState = {
    /**
     * 現在時刻のミリ秒。performance.now、あるいはrequestAnimationFrameから受け取る値
     */
    now: number
    /**
     * framecount関数を呼び出した時刻の数値。
     */
    started: number
    /**
     * framecount関数を呼び出した時刻からの経過時間。
     */
    elapsed: number
    /**
     * 前回のframecountからの経過時間。
     */
    deltaTime: number
    /**
     * 呼び出し回数。
     */
    count: number
}

type TickStateStream = Stream<MomentState> & { disconnect: ()=>void };

/**
 * 時間の更新をイベントストリームとして取得する。
 */
// --- 時間のレシピ集 (The Recipe Book for Time) ---
type moments = {
    /**
     * 一定時間後、一回きりのタイムイベントを取得する
     * @param ms 
     * @returns 
     */
    timeout(ms:number) : Stream<MomentState>
    /**
     * 一定間隔でタイムイベントを取得する
     * @param ms 
     * @returns 
     */
    interval(ms:number) : Stream<MomentState>
    /**
     * 一定回数のフレーム更新を取得する
     * @param limit 
     * @returns 
     */
    framecount(limit:number) : Stream<MomentState>
}


// --- 時間の源泉 (The Fountain of Time) ---

/**
 * blookyアプリケーション全体の実行ループを管理する、統合スケジューラ。
 * requestAnimationFrameを心臓の鼓動（Beat）として、状態、UI、時間、歴史の
 * すべてを同期させる指揮者（Conductor）の役割を担う。
 */

// --- 時間の根源 (The Source of Time) ---
/** * 1フレームに一度だけdripされる、値を持たない純粋な「鼓動」
 * これが全ての時間ベースのリアクティビティの源泉となる。
 */
const _beat$ = stream<void>();
/**
 * 【公開API】アプリケーション全体で共有される、現在の時間を表すProp。
 * 呼び出された瞬間の現在時刻を返す「センサー」としての役割を持つ。
 */
const clock: Prop<number> = () => performance.now();

const calendar = {
    reservations: new Map<DripResult<any>, { resolve: (v:number)=>void, reject: (v:number) => void, at: number }>(),
    schedule: async (r:DripResult<any>, at = clock()) => new Promise((resolve, reject)=>{
        calendar.reservations.set(r, { resolve, reject, at });
        if(clock() >= at) requestAnimationFrame(tick);
    })
}

type MomentStream = Stream<number> & {};

/**
 * 「鼓動」(_beat$)を元に、その瞬間の時刻で意味付けされたMappedStream。
 * これが内部的な「公式時刻」の伝達役となる。
 */
const moment$ : MomentStream = map<number, void>(clock)(_beat$);

// `clock` Propが`moment$`から派生していることを内部的に関連付ける
// これでclockはremap,liftなどから利用できる
PROP_FROM.set(clock, moment$);

// Effect処理のミドルウェア
const tickHandlers = new Set<(effects: DripResult<any>[]) => void>();
// デフォルトの処理の登録
const defaultTickHandler = (e)=>e.forEach((e)=>e.effects.forEach((e)=>e.update(e.nextValue,e.prevValue)));
tickHandlers.add(defaultTickHandler);

// ミドルウェアの登録用関数
function registerTickHandler(handler: (effects: DripResult<any>[]) => void) {
  tickHandlers.add(handler);
  return () => tickHandlers.delete(handler);
}

/**
 * 1フレーム分の処理。この関数内が、一つの「瞬間（Moment）」となる。
 */
function tick(now: number) {
    const beat_effect = drip<void>(void 0)(_beat$);
    const resevations = [...calendar.reservations].flatMap(([effect, {at,resolve,reject}]) => at <= now ? [[effect,resolve,reject] as [DripResult<any>,(v:number)=>void,(v:number)=>void]] : [])
    const queue = [beat_effect,...resevations.map(([effect])=>effect)];
    // 実行キューが空なら終了
    if(!queue.length) return;
    // ハンドラーの呼び出し
    tickHandlers.forEach((handler)=>handler(queue));
    // 処理済みの予定を消去
    resevations.forEach(([effect])=>calendar.reservations.delete(effect));
    // 完了通知
    resevations.forEach(([_,resolve])=>resolve(now));
    // 時間ベースのイベントが残っていれば、次のtickを予約する
    if (beat_effect.effects.length || calendar.reservations.size) requestAnimationFrame(tick);
}

const nextState = (s:MomentState) => (n:number) : MomentState => 
({
    now: n,
    started: s.started,
    elapsed: n - s.started,
    deltaTime: n - s.now,
    count: s.count + 1
});

const tickStateStream = (f?:(s:MomentState)=>boolean): TickStateStream => {
    const started = clock();
    const s = map((n:number): MomentState => nextState(p())(n))(moment$);
    const _s = (f ? filter(f)(s) : s) as Stream<MomentState> as TickStateStream;
    const p = hold({
        started,
        now: started,
        elapsed: 0,
        deltaTime: 0,
        count: 0
    })(_s);
    _s[STREAM_CLEANER] = ()=>{
        moment$.next.delete(s);
    }
    _s.disconnect = ()=>{
        clear(s, true);
        moment$.next.delete(s);
    };
    return _s;
}


/**
 * 【公開API】時間ベースのイベントを生成するファクトリ
 */
const moments = {
  /**
   * 指定した間隔でイベントを発行するStreamを生成する
   * @param ms 間隔（ミリ秒）
   * @returns 経過時間(deltaTime)を値として持つStream
   */
  interval(ms: number): TickStateStream {
    if(!hasReferences(moment$)) requestAnimationFrame(tick);
    const s = tickStateStream(({deltaTime})=>deltaTime >= ms);
    const c = countReferences(s,true)() + 1;
    when(()=>!hasReferences(s,c))(STREAM_PROP_RELATIONS.get(s)![0]).then(s.disconnect);
    return s;
  },

  /**
   * 指定した時間後に一度だけイベントを発行するStreamを生成する
   * @param ms 遅延時間（ミリ秒）
   * @returns 経過時間(deltaTime)を値として持つStream
   */
  timeout(ms: number): TickStateStream {
    if(!hasReferences(moment$)) setTimeout(tick, ms);
    const s = tickStateStream(({elapsed})=> ms <= elapsed);
    when<MomentState>(({elapsed})=>ms<=elapsed)(STREAM_PROP_RELATIONS.get(s)![0]).then(s.disconnect);
    return s;
  },
};



export {
    drip,stream,
    isStream,isDripperStream,isChainedProp,
    countReferences,hasReferences,clear,
    merge,junction,map,filter,
    hold,accum,lift,remap,when,
    proxy,
    clock,moments,calendar,registerTickHandler
};

export type {
    Stream,FilterStream,MappedStream,MergedStream,DripperStream,
    Prop,PromisedProp,
    TickStateStream as MomentStream,MomentState,
};
