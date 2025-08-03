/**
 * blooky.ts
 * 関数型のリアクティブプログラミングをtypescriptで行うためのライブラリ。
 */

import { execute, fx, run, type FxNode } from "./blooky-effect";

const STREAM_FILTER = Symbol("STREAM_FILTER");
const STREAM_CLEANER = Symbol("STREAM_CLEANER");
const STREAM_PROP_RELATIONS = new WeakMap<Stream<any>,Prop<any>[]>();
/**
 * 値を運んでくるストリーム
 */
const PROP_FROM = new WeakMap<Prop<any>, Stream<any>>();
/**
 * Propの値を更新する
 */
const PROP_UPDATE = new WeakMap<Prop<any>, (v:any)=>void>();
/**
 * イベントの発生を検知するオブザーバ
 */
const PROP_OBSERVERS = new WeakMap<Prop<any>, Set<(v:any,prev?:any)=>void>>();

/**
 * ストリームの状態定義。
 * ファンクタをベースに生成し、対応する時変値の更新と次のストリームへの接続用情報を保持する。
 */
type Stream<A> = {
    /**
     * フィルタ。受け入れられる値かを判断する。
     * @param v 
     * @returns 
     */
    [STREAM_FILTER]: (v:A) => boolean

    /**
     * ガベージコレクション
     * @returns 
     */
    [STREAM_CLEANER]?: ()=>void

    /**
     * 連結されたストリーム
     */
    next: Map<Stream<any>,(v:A)=>any>
    /**
     * 連結先のうち、マージされる可能性のあるストリーム
     */
    lazyNext: Set<MergedStream<A>>
};

type MergedStream<A> = Stream<A> & { reducer: (a:A,b:A)=>A };

/**
 * 連結したストリームを辿り、受け取った時変値の処理関数をまとめる
 */
type FlowingState = [[MergedStream<any>,any][], (()=>void)[], (()=>void)[]];

// 副作用の集合体
type Effect = FlowingState;

/**
 * 時変値を返す関数の型。
 */
type Prop<A> = ()=>A;

const parrot = <A>(v:A) => v;
const compose = <A,B>(a:(v:A)=>B) => <C>(b:(v:B)=>C) => (v:A) => b(a(v));
export {parrot,compose};

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
            s.next.forEach((_, nextStream) => clear(nextStream, recursive, visited));
            s.lazyNext.forEach((nextStream) => clear(nextStream, recursive, visited));
        }
        if (s[STREAM_CLEANER]) s[STREAM_CLEANER]();
        s.next.clear();
        s.lazyNext.clear();
        if(STREAM_PROP_RELATIONS.has(s)) {
            STREAM_PROP_RELATIONS.get(s)!.forEach((p)=>{
                PROP_FROM.delete(p);
                PROP_OBSERVERS.delete(p);
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
            PROP_OBSERVERS.delete(v);
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
const stream = <A>(f: (v: A) => boolean = () => true): Stream<A> => {
    if (typeof f !== 'function') {
        throw new TypeError('STREAM_FUNCTOR must be a function');
    }
    const s: Stream<A> = {
        [STREAM_FILTER]: f,
        next: new Map(),
        lazyNext: new Set(),
    };
    // StreamがGCされたら自動clear
    cleanupRegistry.register(s, new WeakRef(s));
    return s;
};



/**
 * 引数がストリームであるかを判別する。
 * @param v 
 * @returns 
 */
const isStream = <A>(v:unknown) : v is Stream<A> => typeof v === "object" && v != null && STREAM_FILTER in v;

/**
 * これくらいスムーズに書き下したいんだけど、せめて循環参照はチェックする
 * 
const countReferences = (s:Stream<any>,deep = false) => 
    deep === true
    ? [...s.next.keys(),...s.lazyNext].reduce((n,s)=> n + _countReferences(s,deep)(), s.updates.size + s.observers.size)
    : s.updates.size + s.observers.size
 */

/**
 * ストリームがオブザーバかプロパティによってどれだけ参照されているかを調べる
 * @param s 
 * @returns 
 */
const countReferences = (s: Stream<any>, deep = false): Prop<number> => {
  if (!isStream(s)) throw new TypeError("countReferences requires Stream");
  const countDirect = (s: Stream<any>) => STREAM_PROP_RELATIONS.has(s) ? STREAM_PROP_RELATIONS.get(s)!.length : 0;
  const countDeep = (s: Stream<any>, visited: WeakSet<Stream<any>>): number => {
    if(visited.has(s)) return 0;
    visited.add(s);
    return [...s.next.keys(), ...s.lazyNext].reduce((acc, child) => acc + countDeep(child, visited), countDirect(s));
  };
  return deep === true
    ? () => countDeep(s, new WeakSet())
    : () => countDirect(s);
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
        const o = STREAM_PROP_RELATIONS.get(current)!;
        if (o.length) count += o.length;
        if (count > than) return true;
        stack.push(...current.next.keys(), ...current.lazyNext);
    }
    return false;
};

/**
 * 受け取った時変値でフロー状態を作成する
 * @param v 
 * @returns 
 */
const streamToFlowingState = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const waiting = [...s.lazyNext].map((s) => [s,v] as [MergedStream<any>,any]);
    if(!STREAM_PROP_RELATIONS.has(s)) return [waiting, [], []];
    const p = STREAM_PROP_RELATIONS.get(s)!;
    const observers = p.map((p)=>PROP_OBSERVERS.has(p) ? ()=>[...PROP_OBSERVERS.get(p)!].forEach((o)=>o(v,p())) : ()=>{});
    const update   = p.map((p)=>PROP_UPDATE.has(p) ? ()=>PROP_UPDATE.get(p)!(v) : ()=>{});
    return [waiting,observers,update];
}
/**
 * 二つのフロー状態を結合して単一のフロー状態とする
 * @param a 
 * @param b 
 * @returns 
 */
const concatFlowingState = (a:FlowingState, b:FlowingState) => [
    a[0].concat(b[0]),
    a[1].concat(b[1]),
    a[2].concat(b[2])
] as FlowingState;

/**
 * 時変値を受け取って指定のストリームからフローを開始、開始されたフロー状態を返す。
 * @param v 
 * @returns 
 */
const flow = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    try {
        return s[STREAM_FILTER](v)
            ? [...s.next]
                .map(([_s,f])=>flow(f(v))(_s))
                .reduce(concatFlowingState, streamToFlowingState(v)(s))
            : [[],[],[]];
    } catch (error) {
        console.error('Error in flow function:', error);
        return [[],[],[]]; // エラー時のデフォルト状態を返す
    }
}

/**
 * マージ予定ストリームの遅延処理を施したフロー関数。
 * @param v 
 * @returns 
 */
const flowLazy = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const r = flow(v)(s);
    const [waiting,observers,updates] = r;
    // マージされたストリームとはつながっていない
    if(!waiting.length) return r;
    // マージされたストリーム毎に、到着した値をリスト化する
    const m = waiting.reduce((m,[s,v])=> {
        m.set(s, m.has(s) ? m.get(s)!.concat(v) : [v]);
        return m;
    }, new Map<MergedStream<any>,any[]>());
    // ストリーム毎のreducerを呼んだ上で通常のstreamとしてflowする
    return [...m].map(([s,v])=>flowLazy(v.reduce(s.reducer))(s)).reduce(concatFlowingState, [[],observers,updates]);
}

/**
 * 起点となるストリームに時変値を流し込み、関連するオブザーバの呼び出しと時変値の更新を行う。
 * @param s 
 * @returns 
 */

// 1. Stream<void>用のオーバーロードシグネチャ
// 引数を取らない関数を返すことを明記
function drip(s: Stream<void>): () => Effect;

// 2. それ以外の汎用的なStream<A>用のオーバーロードシグネチャ
// 型Aの引数を1つ取る関数を返すことを明記
function drip<A>(s: Stream<A>): (v: A) => Effect;

// 関数本体
function drip<A>(s: Stream<A>) {
    const dripFn = (v: A) => {
        execute(run(dripEffectToFxNodeSaga(flowLazy(v)(s))));
    };
    // drip関数に、atomicモードで実行するメソッドを生やす
    dripFn.atomic = (v: A) => {
        execute(run(dripEffectToFxNodeAtomic(flowLazy(v)(s))));
    };
    return dripFn as any; // 型推論を助けるためにanyにキャストするが、関数のシグネチャが型安全性を保証する
};

// drip-Atomicモード：全処理を一つのfx.callにまとめる
const dripEffectToFxNodeAtomic = ([_,observers,updates]: Effect) => fx.call(() => {
    if(dripEffectToFxNodeAtomic.observerPhase) { console.error("drip.observerPhase is true: observer recursion called"); return; };
    dripEffectToFxNodeAtomic.observerPhase = true;
    observers.forEach((f)=>f());
    dripEffectToFxNodeAtomic.observerPhase = false;
    updates.forEach(f => f());
});
// adomicモードのdrip時に参照する。drip再帰を防ぐトラップ
dripEffectToFxNodeAtomic.observerPhase = false;

// drip-Sagaモード：詳細なFxNodeツリーを構築
const dripEffectToFxNodeSaga = ([_,observers,updates]: Effect) => {
    const observerNodes = observers.map(fx.call);
    const updateNodes = updates.map(fx.call);
    return fx.sequence([
      fx.parallel(observerNodes),
      fx.parallel(updateNodes),
    ]);
};

/**
 * 二つ以上のイベントストリームを一つにまとめる
 * @param s 
 * @returns 
 */
const merge = <A> (s:Stream<A>[]) => (f?:(a:A,b:A)=>A) : MergedStream<A> => {
    // マージ後のストリーム
    const _s = stream() as MergedStream<A>;
    _s.reducer = f || ((_,v) => v);
    _s[STREAM_CLEANER] = () => {
        s.forEach((s)=>s.lazyNext.delete(_s));
    };
    s.forEach((s)=>s.lazyNext.add(_s));
    return _s;
};

/**
 * ストリームを分岐させる
 * @param s 
 * @returns 
 */
const pipe = <A>(s:Stream<A>) => <B>(f:(v:A)=>B) : Stream<B> => {
    if (typeof f !== 'function') {
        throw new TypeError('pipe function must be a function');
    }
    const _s = stream<B>();
    _s[STREAM_CLEANER] = () => s.next.delete(_s);
    s.next.set(_s, f);
    return _s;
}

/**
 * プロパティを別プロパティに変換する
 */
const map = <A>(p:Prop<A>) => <B>(f:(v:A,p?:A)=>B) => 
    PROP_FROM.has(p)
        ? hold(pipe(PROP_FROM.get(p)!)((v:A)=>f(v,p())))(f(p()))
        : ()=>f(p());

/**
 * 時変値に関数を適用して新しい時変値を作る
 * @param c 
 * @returns 
 */
const lift = <A>(props: Prop<any>[]) => (f: (values: any[]) => A): Prop<A> => {
  const valueFn = () => f(props.map(p => p()));
  // Streamを持っているPropだけを集める
  const streams = props.flatMap((p, i) => PROP_FROM.has(p) ? pipe(PROP_FROM.get(p)!)((v) => [[i, v]] as [number, any][]) : []);
  const mergedStream = merge(streams)((a, b) => a.concat(b));
  const transformed = pipe(mergedStream)((updates) => {
    const map = new Map(updates);
    return f(props.map((p, i) => map.has(i) ? map.get(i)! : p()));
  });
  transformed[STREAM_CLEANER] = () => {
    streams.forEach((s)=>clear(s));
  };
  return hold(transformed)(valueFn());
};

/**
 * イベントストリームから条件に合う値だけを取り出すストリームを生成する
 * @param s 
 * @returns 
 */
const filter = <A>(s:Stream<A>) => (f:(v:A)=>boolean): Stream<A> => {
    const _s = stream(f);
    s.next.set(_s,parrot);
    return _s;
}

/**
 * イベントストリームからプロパティを作る
 * @param s 
 * @returns 
 */
const hold = <A>(s:Stream<A>) => (v:A) : Prop<A> => {
    const p = (() => v) as Prop<A>;
    PROP_FROM.set(p, s);
    PROP_UPDATE.set(p, (_v) => v = _v);
    PROP_OBSERVERS.set(p, new Set());
    STREAM_PROP_RELATIONS.set(s, STREAM_PROP_RELATIONS.has(s) ? [...STREAM_PROP_RELATIONS.get(s)!,p] : [p]);
    cleanupRegistry.register(p, new WeakRef(p));
    return p;
}

/**
 * Propにオブザーバーを登録する
 */
const listen = <A>(p:Prop<A>) => function (f:(v:A,s?:A)=>void, options?: { immediate?: A }) : ()=>void {
    if(!PROP_OBSERVERS.has(p)) return ()=>{};
    const observers = PROP_OBSERVERS.get(p)!;
    observers.add((v:A)=>f(v,p()));
    const unsubscribe = observers.delete.bind(observers, f);
    if(options && "immediate" in options) f(p(), options.immediate);
    return unsubscribe;
};

/**
 * イベントストリームから一つの値を計算する
 */
const accum = <A>(_s:Stream<A>) => <S>(f:(v:A,s:S)=>S, s: S) : Prop<S> => {
    const p: Prop<S> = hold(pipe(_s)((v:A)=>f(v,p())))(s);
    return p;
}

/**
 * 値を受け取るストリームをスイッチする
 * @param ss 
 * @returns 
 */
const shed = <A>(ss: Stream<Stream<A>>) => {
    const o = stream<A>();
    const p = hold(ss)(o);
    const l = listen(p)((s)=>{
        p().next.delete(o);
        s.next.set(o,parrot);
    });
    o[STREAM_CLEANER] = () => {
        p().next.delete(o);
        l();
    }
    return o;
}

/**
 * moments.framecountのファンクタに渡される状態変数。
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

type MomentStream = Stream<MomentState> & { disconnect: ()=>void };

/**
 * 時間の更新をイベントストリームとして取得する。
 */
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

const moments = {} as moments; {

    const now: Prop<number> = performance.now.bind(performance);
    const nextState = (s:MomentState) => (n:number) : MomentState => 
    ({
        now: n,
        started: s.started,
        elapsed: n - s.started,
        deltaTime: n - s.now,
        count: s.count + 1
    });
    const tickStateStream = (f?:(s:MomentState)=>boolean): MomentStream => {
        const started = now();
        const s = pipe(globalTickStream)((n:number): MomentState => nextState(p())(n));
        const _s = (f ? filter(s)(f) : s) as MomentStream;
        const p = hold(_s)({
            started,
            now: started,
            elapsed: 0,
            deltaTime: 0,
            count: 0
        });
        _s[STREAM_CLEANER] = ()=>{
            globalTickStream.next.delete(s);
        }
        _s.disconnect = ()=>{
            clear(s, true);
            globalTickStream.next.delete(s);
        };
        return _s;
    }

    const globalTickStream = stream<number>();
    const tick = (t:number) => {
        if(!hasReferences(globalTickStream)) return;
        const [_,observers,updates] = flowLazy(t)(globalTickStream);
        observers.forEach(f => f());
        updates.forEach(f => f());
        if(hasReferences(globalTickStream))
            requestAnimationFrame(tick);
    };

    moments.timeout = (ms:number = 0) => {
        if(!hasReferences(globalTickStream)) requestAnimationFrame(tick);
        const s = tickStateStream(({elapsed})=>ms <= elapsed);
        listen(STREAM_PROP_RELATIONS.get(s)![0])(s.disconnect);
        return s;
    };

    moments.interval = (ms: number = 0) => {
        if(!hasReferences(globalTickStream)) requestAnimationFrame(tick);
        const s = tickStateStream(({deltaTime})=>deltaTime >= ms);
        const c = countReferences(s,true)() + 1;
        listen(STREAM_PROP_RELATIONS.get(s)![0])(()=>{
            if(!hasReferences(s,c)) s.disconnect();
        });
        return s;
    };

    moments.framecount = typeof window.requestAnimationFrame === "function"
        ? (limit: number = Infinity) => {
            if(!hasReferences(globalTickStream)) requestAnimationFrame(tick);
            const s = tickStateStream(limit === Infinity ? undefined : ({count})=>count<=limit);
            if(limit) listen(STREAM_PROP_RELATIONS.get(s)![0])(({count})=>{
                if(count===limit) s.disconnect();
            })
            return s;
        }
        : (_:number) => {throw new Error('moments.framecount function need "requestAnimationFrame" function')};

}

export {stream,isStream,countReferences,hasReferences,clear,hold,accum,lift,merge,pipe,map,filter,listen,drip,shed,moments};
export type {Stream,MergedStream,MomentState,MomentStream,Prop};
