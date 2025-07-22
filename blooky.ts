/**
 * blooky.ts
 * 関数型のリアクティブプログラミングをtypescriptで行うためのライブラリ。
 */

const STREAM_FUNCTOR = Symbol("STREAM_FUNCTOR");
const STREAM_FILTER = Symbol("STREAM_FILTER");
const STREAM_CLEANER = Symbol("STREAM_CLEANER");


/**
 * ストリームの状態定義。
 * ファンクタをベースに生成し、対応する時変値の更新と次のストリームへの接続用情報を保持する。
 */
type StreamState<A> = {
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
    next: Map<StreamState<any>,(v:A)=>any>
    /**
     * 連結先のうち、マージされる可能性のあるストリーム
     */
    lazyNext: Set<MergedStream<A>>
    /**
     * イベント発生後に行うPROP更新
     */
    updates: Set<(v:A)=>void>
    /**
     * イベントの発生を検知するオブザーバ
     */
    observers: Set<(v:A)=>void>
};

type MergedStream<A> = StreamState<A> & { reducer: (a:A,b:A)=>A };

/**
 * 連結したストリームを辿り、受け取った時変値の処理関数をまとめる
 */
type FlowingState = {
    waiting: [MergedStream<any>,any][]
    observers: (()=>void)[]
    updates: (()=>void)[]
}

export type Stream<A> = StreamState<A>;

/**
 * 時変値を返す関数の型。
 */
export type Prop<A> = {
    (): A
}

const parrot = <A>(v:A) => v;
const compose = <A,B>(a:(v:A)=>B) => <C>(b:(v:B)=>C) => (v:A) => b(a(v));
export {parrot,compose};


const TRUE = ()=>true;
/**
 * ストリーム状態を生成する。
 * @param f 
 * @returns 
 */
const stream = <A>(f?:(v:A)=>boolean) : StreamState<A> => {
    if (typeof f !== 'function') {
        throw new TypeError('STREAM_FUNCTOR must be a function');
    }
    return {
        [STREAM_FILTER]: f || TRUE,
        next: new Map(),
        lazyNext: new Set(),
        observers: new Set(),
        updates: new Set()
    }
}

/**
 * ストリーム/プロパティのメモリを解放する。ガベージコレクトの補助。
 * @param s 
 */
const clear = <A>(s:Stream<A>) => {
    if (!isStream<A>(s))
        throw new TypeError('clear function is need Stream or Prop type');
    s.next.forEach((_,s)=>clear(s));
    s.next = new Map();
    s.lazyNext = new Set();
    s.observers.clear();
    s.updates.clear();
    if(s[STREAM_CLEANER]) s[STREAM_CLEANER]();
}

/**
 * 引数がストリームであるかを判別する。
 * @param v 
 * @returns 
 */
const isStream = <A>(v:unknown) : v is Stream<A> => typeof v === "object" && v != null && STREAM_FUNCTOR in v;

/**
 * ストリームがオブザーバかプロパティによってどれだけ参照されているかを調べる
 * @param s 
 * @returns 
 */
const countRefs = <V>(s:Stream<V>, deep: boolean = false) : Prop<number> => {
    if(!isStream(s)) throw new TypeError("countRefs function is need stream type");
    return deep
        ? () => [...s.next].reduce((v,[s]) => v + countRefs(s,deep)(), s.observers.size + s.updates.size)
              + [...s.lazyNext].reduce((v,s) => v + countRefs(s,deep)(), s.observers.size + s.updates.size)
        : () => s.observers.size + s.updates.size;
}


/**
 * 受け取った時変値でフロー状態を作成する
 * @param v 
 * @returns 
 */
const streamToFlowingState = <A>(v:A) => (s:StreamState<A>) : FlowingState => ({
    waiting: [...s.lazyNext].map((s) => [s,v]),
    observers: [...s.observers].map((_f) => () => _f(v)),
    // PROPのアップデーターが残っていれば使用し、残っていないならガベージコレクト用にストリームからも消去。
    updates: [...s.updates].map((p) => ()=>p(v))
})

/**
 * 二つのフロー状態を結合して単一のフロー状態とする
 * @param a 
 * @param b 
 * @returns 
 */
const concatFlowingState = (a:FlowingState, b:FlowingState) => ({
    waiting: [...a.waiting, ...b.waiting],
    observers: [...a.observers, ...b.observers],
    updates: [...a.updates, ...b.updates]
});

/**
 * 時変値を受け取って指定のストリームからフローを開始、開始されたフロー状態を返す。
 * @param v 
 * @returns 
 */
const flow = <A>(v:A) => (s:StreamState<A>) : FlowingState => {
    try {
        return s[STREAM_FILTER](v)
            ? [...s.next]
                .map(([_s,f])=>flow(f(v))(_s))
                .reduce(concatFlowingState, streamToFlowingState(v)(s))
            : { waiting: [], observers: [], updates: [] };
    } catch (error) {
        console.error('Error in flow function:', error);
        return { waiting: [], observers: [], updates: [] }; // エラー時のデフォルト状態を返す
    }
}

/**
 * マージ予定ストリームの遅延処理を施したフロー関数。
 * @param v 
 * @returns 
 */
const flowLazy = <A>(v:A) => (s:StreamState<A>) : FlowingState => {
    const r = flow(v)(s);
    // マージされたストリームとはつながっていない
    if(!r.waiting.length) return r;
    
    // マージされたストリーム毎に、到着した値をリスト化する
    const m = new Map<MergedStream<unknown>,unknown[]>();
    r.waiting.forEach(([s,v]) => {
        m.set(s, m.has(s) ? [...m.get(s)!, v] : [v]);
    });

    return [...m].map(([s,v])=>flowLazy(v.reduce(s.reducer))(s)).reduce(concatFlowingState, {
        waiting: [],
        observers: r.observers,
        updates: r.updates
    });
}

/**
 * 起点となるストリームに時変値を流し込み、関連するオブザーバの呼び出しと時変値の更新を行う。
 * @param s 
 * @returns 
 */
const drip = <A>(s: StreamState<A>) => (v:A) : FlowingState => {
    if (drip.observerPhase) {
        throw new Error('drip cannot be called during observer phase');
    }
    try {
        const state = flowLazy(v)(s);
        drip.observerPhase = true;
        state.observers.forEach(f => f());
        drip.observerPhase = false;
        state.updates.forEach(f => f());
        return state;
    } catch (error) {
        console.error('Error in drip function:', error);
        drip.observerPhase = false;
        return { waiting: [], observers: [], updates: [] }; // エラー時のデフォルト状態を返す
    }
};

drip.observerPhase = false;


/**
 * 二つ以上のイベントストリームを一つにまとめる
 * @param s 
 * @returns 
 */
const merge = <A> (s:StreamState<A>[]) => (f:(a:A,b:A)=>A) : MergedStream<A> => {
    // マージ後のストリーム
    const _s = stream() as MergedStream<A>;
    _s.reducer = f;
    _s[STREAM_CLEANER] = () => s.forEach((s)=>s.lazyNext.delete(_s));
    s.forEach((s)=>s.lazyNext.add(_s));
    return _s;
};

/**
 * ストリームを分岐させる
 * @param s 
 * @returns 
 */
const pipe = <A>(s:StreamState<A>) => <B>(f:(v:A)=>B) : StreamState<B> => {
    if (typeof f !== 'function') {
        throw new TypeError('pipe function must be a function');
    }
    const _s = stream<B>();
    _s[STREAM_CLEANER] = () => _s.next.delete(s);
    s.next.set(_s, f);
    return _s;
}

/**
 * 時変値に関数を適用して新しい時変値を作る
 * @param c 
 * @returns 
 */
const lift = <A>(c:Prop<any>[]) => (f:(p: any[])=>A) : Prop<A> => () => f(c.map((f)=>f()));

/**
 * イベントストリームから条件に合う値だけを取り出すストリームを生成する
 * @param s 
 * @returns 
 */
const filter = <A>(s:Stream<A>) => (f:(v:A)=>boolean): StreamState<A> => {
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
    s.updates.add((_v)=>v=_v);
    return ()=>v;
}

/**
 * イベントストリームにオブザーバーを登録する
 * @param param0 
 * @returns 
 */
const listen = <A>({observers}:Stream<A>) => (f:(v:A)=>void) => {
    observers.add(f);
    return observers.delete.bind(observers, f);
};

/**
 * イベントストリームから一つの値を計算する
 * @param _s 
 * @returns 
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
    const l = listen(ss)((s)=>{
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
        _s.disconnect = ()=>{
            clear(s);
            globalTickStream.next.delete(s);
        };
        return _s;
    }

    const globalTickStream = stream<number>();
    const tick = (t:number) => {
        const state = flowLazy(t)(globalTickStream);
        state.observers.forEach(f => f());
        state.updates.forEach(f => f());
        if(countRefs(globalTickStream,true)()>0)
            requestAnimationFrame(tick);
    };

    moments.timeout = (ms:number = 0) => {
        if(!countRefs(globalTickStream, true)()) requestAnimationFrame(tick);
        const s = tickStateStream(({elapsed})=>ms <= elapsed);
        listen(s)(s.disconnect);
        return s;
    };

    moments.interval = (ms: number = 0) => {
        if(!countRefs(globalTickStream, true)()) requestAnimationFrame(tick);
        const s = tickStateStream((state)=>state.deltaTime >= ms);
        const c = countRefs(s)();
        listen(s)(()=>{
            if(countRefs(s, true)() <= c) s.disconnect();
        });
        return s;
    };

    moments.framecount = typeof window.requestAnimationFrame === "function"
        ? (limit: number = Infinity) => {
            if(!countRefs(globalTickStream, true)()) requestAnimationFrame(tick);
            const s = tickStateStream(limit === Infinity ? undefined : ({count})=>count<=limit);
            if(limit) listen(s)(({count})=>{
                if(count===limit) s.disconnect();
            })
            return s;
        }
        : (_:number) => {throw new Error('moments.framecount function need "requestAnimationFrame" function')};


}
export {stream,isStream,countRefs,clear,hold,accum,lift,merge,pipe,filter,listen,drip,shed,moments};

