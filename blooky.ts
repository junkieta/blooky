/**
 * blooky.ts
 * 関数型のリアクティブプログラミングをtypescriptで行うためのライブラリ。
 */

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
};


const IS_DRIPPER = Symbol("IS_DRIPPER");

type DripperStream<A> = Stream<A> & {
    IS_DRIPPER: typeof IS_DRIPPER
}
type MergedStream<A> = Stream<A> & {
    reducerFn: (a:A,b:A)=>A
};
type MappedStream<A,B> = Stream<A> & {
    mapFn: (v:B)=>A
};
type FilterStream<A> = Stream<A> & { 
    /**
     * フィルタ。受け入れられる値かを判断する。
     * @param v 
     * @returns 
     */
    filterFn: (v:A)=>boolean 
}

/**
 * 連結したストリームを辿り、受け取った時変値の処理関数をまとめる
 */
type FlowingState = [(()=>void)[], (()=>void)[], [MergedStream<any>,any][]];

// 副作用の集合体
type Effect = {
    created: number
    observers: (()=>void)[]
    updates: (()=>void)[]
};
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
            s.next.forEach((nextStream) => clear(nextStream, recursive, visited));
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
const stream = <A>(): Stream<A> => {
    const s: DripperStream<A> = {
        next: new Set(),
        lazyNext: new Set(),
        IS_DRIPPER
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
        reducerFn: f || ((_,v) => v),
        [STREAM_CLEANER]: () => {
            s.forEach((s)=>s.lazyNext.delete(_s));
        }
    };
    s.forEach((s)=>s.lazyNext.add(_s));
    return _s;
};

/**
 * イベントストリームから条件に合う値だけを取り出すストリームを生成する
 * @param s 
 * @returns 
 */
const filter = <A>(f:(v:A)=>boolean) => (s:Stream<A>) : FilterStream<A> => {
    const _s: FilterStream<A> = {
        filterFn: f,
        next: new Set(),
        lazyNext: new Set(),
    };
    cleanupRegistry.register(_s, new WeakRef(s));
    return _s;
}

/**
 * ストリームを別の流れに変換する
 */
const map = <A,B>(f:(v:B)=>A) => (p:Stream<B>) : MappedStream<A,B> => ({
    mapFn: f,
    next: new Set(),
    lazyNext: new Set()
});

/**
 * イベントストリームから一つの値を計算する
 */
const accum = <A>(_s:Stream<A>) => <S>(f:(v:A,s:S)=>S, s: S) : Prop<S> => {
    const p: Prop<S> = hold(s)(map((v:A)=>f(v,p()))(_s));
    return p;
}

/**
 * 値を受け取るストリームをスイッチする
 * @param ss 
 * @returns 
 */
const shed = <A>(ss: Stream<Stream<A>>) => {
    const o = stream<A>();
    const p = hold(o)(ss);
    const l = listen<Stream<A>>((s)=>{
        (p().next as Set<Stream<A>>).delete(o);
        (s.next as Set<Stream<A>>).add(o);
    })(p);
    o[STREAM_CLEANER] = () => {
        (p().next as Set<Stream<A>>).delete(o);
        l();
    }
    return o;
}

/**
 * 引数がストリームであるかを判別する。
 * @param v 
 * @returns 
 */
const isStream = <A>(v:unknown) : v is Stream<A> => 
    v != null && typeof v === "object" && "next" in v && "lazyNext" in v;

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
    return [...s.next, ...s.lazyNext].reduce((acc, child) => acc + countDeep(child, visited), countDirect(s));
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
    const waiting = [...s.lazyNext].map((s) => [s,v] as [MergedStream<any>,any]);
    if(!STREAM_PROP_RELATIONS.has(s)) return [[], [], waiting];
    const p = STREAM_PROP_RELATIONS.get(s)!;
    const observers = p.map((p)=>PROP_OBSERVERS.has(p) ? ()=>[...PROP_OBSERVERS.get(p)!].forEach((o)=>o(v,p())) : ()=>{});
    const update   = p.map((p)=>PROP_UPDATE.has(p) ? ()=>PROP_UPDATE.get(p)!(v) : ()=>{});
    return [update,observers,waiting];
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
        const next = [...s.next].filter((s)=> !("filterFn" in s) || s.filterFn(v));
        return next.length
            ? next.map((_s) => flow("mapFn" in _s ? _s.mapFn(v) : v)(_s))
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
    const [updates,observers,waiting] = r;
    // マージされたストリームとはつながっていない
    if(!waiting.length) return r;
    // マージされたストリーム毎に、到着した値をリスト化する
    const m = waiting.reduce((m,[s,v])=> {
        m.set(s, m.has(s) ? m.get(s)!.concat(v) : [v]);
        return m;
    }, new Map<MergedStream<any>,any[]>());
    // ストリーム毎のreducerを呼んだ上で通常のstreamとしてflowする
    return [...m].map(([s,v])=>flowLazy(v.reduce(s.reducerFn))(s)).reduce(concatFlowingState, [updates,observers,[]]);
}


/**
 * 起点となるストリームに時変値を流し込み、関連するオブザーバの呼び出しと時変値で構成されたEffectを返す。
 * @param s 
 * @returns 
 */
const drip = <A>(v:A) => (d:DripperStream<A>) : Effect => {
    const [observers,updates] = flowLazy(v)(d);
    return {observers,updates,created:Date.now()};
};

/**
 * イベントストリームからプロパティを作る
 * @param s 
 * @returns 
 */
const hold = <A>(v:A) => (s:Stream<A>): Prop<A> => {
    const p = (() => v) as Prop<A>;
    PROP_FROM.set(p, s);
    PROP_UPDATE.set(p, (_v) => v = _v);
    PROP_OBSERVERS.set(p, new Set());
    STREAM_PROP_RELATIONS.set(s, STREAM_PROP_RELATIONS.has(s) ? [...STREAM_PROP_RELATIONS.get(s)!,p] : [p]);
    cleanupRegistry.register(p, new WeakRef(p));
    return p;
}

/**
 * プロパティを別プロパティに変換する
 */
const remap = <A,B>(f:(v:B,p?:B)=>A) => (p:Prop<B>) : Prop<A> => 
    PROP_FROM.has(p)
        ? hold(f(p()))(PROP_FROM.get(p)!)
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


/**
 * Propにオブザーバーを登録する
 */
const listen = <A>(f:(v:A,s?:A)=>void, options?: { immediate?: A }) => (p:Prop<A>) => {
    if(!PROP_OBSERVERS.has(p)) return ()=>{};
    const observers = PROP_OBSERVERS.get(p)!;
    observers.add((v:A)=>f(v,p()));
    const unsubscribe = observers.delete.bind(observers, f);
    if(options && "immediate" in options) f(p(), options.immediate);
    return unsubscribe;
};

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
        const s = map((n:number): MomentState => nextState(p())(n))(globalTickStream);
        const _s = (f ? filter(f)(s) : s) as Stream<MomentState> as MomentStream;
        const p = hold({
            started,
            now: started,
            elapsed: 0,
            deltaTime: 0,
            count: 0
        })(_s);
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
        const [observers,updates] = flowLazy(t)(globalTickStream);
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
            if(limit) listen(({count}:{count:number})=>{ if(count===limit) s.disconnect(); })(STREAM_PROP_RELATIONS.get(s)![0]);
            return s;
        }
        : (_:number) => {throw new Error('moments.framecount function need "requestAnimationFrame" function')};

}

export {drip,stream,isStream,countReferences,hasReferences,clear,hold,accum,lift,merge,map,remap,filter,listen, shed,moments};
export type {Stream,FilterStream,MappedStream,MergedStream,DripperStream,MomentState,MomentStream,Prop,Effect};
