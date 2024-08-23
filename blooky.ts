/**
 * blooky.ts
 * 関数型のリアクティブプログラミングをtypescriptで行うためのライブラリ。
 */

const STREAM_FUNCTOR = Symbol("STREAM_FUNCTOR");
const STREAM_FILTER = Symbol("STREAM_FILTER");

/**
 * ストリームの状態定義。
 * ファンクタをベースに生成し、対応する時変値の更新と次のストリームへの接続用情報を保持する。
 */
type StreamState<A,B=any,C=any> = {
    /**
     * ファンクタ。A->Bの変換だけを行う。
     * @param v 
     * @returns 
     */
    [STREAM_FUNCTOR]: (v:B) => A
    /**
     * フィルタ。受け入れられるAかを判断する。
     * @param v 
     * @returns 
     */
    [STREAM_FILTER]?: (v:B) => boolean
    /**
     * 連結されたストリーム
     */
    next: Set<StreamState<C,A>>
    /**
     * 連結先のうち、マージされる可能性のあるストリーム
     */
    lazyNext: Set<StreamState<A,A[]>>
    /**
     * イベント発生後に行うPROP更新
     */
    updates: Set<Prop<A>>
    /**
     * イベントの発生を検知するオブザーバ
     */
    observers: Set<(v:A)=>void>
};

/**
 * 連結したストリームを辿り、受け取った時変値の処理関数をまとめる
 */
type FlowingState<A> = {
    waiting: [StreamState<A,A[]>,A][]
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

/**
 * Prop型とその値を更新する関数のマップ。
 * Propがガベージコレクトで自動解放されるようWeakMapとしつつ、
 * 手動でもclear関数を経由して削除できるようにしている。
 */
const PROP_UPDATER = new WeakMap<Prop<any>,(v:any)=>void>();

/**
 * ストリーム状態を生成する。
 * @param f 
 * @returns 
 */
const stream = <A,B=any>(f:(v:B)=>A = parrot as (v:B)=>A) : StreamState<A,B> => {
    if (typeof f !== 'function') {
        throw new TypeError('STREAM_FUNCTOR must be a function');
    }
    return {
        [STREAM_FUNCTOR]: f,
        next: new Set(),
        lazyNext: new Set(),
        observers: new Set(),
        updates: new Set(),
    }
}

/**
 * ストリーム/プロパティのメモリを解放する。ガベージコレクトの補助。
 * @param s 
 */
const clear = (s:Stream<unknown>|Prop<unknown>) => {
    if(typeof s === "function") {
        PROP_UPDATER.delete(s);
    }
    else if (!isStream(s)) {
        throw new TypeError('clear function is need stream type');
    }
    else {
        s.next.forEach(clear);
        s.next = new Set();
        s.lazyNext = new Set();
        s.observers.clear();
        // プロパティアップデータを削除する
        s.updates.forEach((p)=>PROP_UPDATER.delete(p));
        s.updates = new Set();
    }
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
const countRefs = <V>(s:Stream<V>) : number => {
    if(!isStream(s)) throw new TypeError("countRefs function is need stream type");
    return [...s.next,...s.lazyNext].reduce((v,s) => v + countRefs(s), s.observers.size + s.updates.size);
}

/**
 * 受け取った時変値でフロー状態を作成する
 * @param v 
 * @returns 
 */
const streamToFlowingState = <A>(v:A) => (s:StreamState<A>) : FlowingState<A> => ({
    waiting: [...s.lazyNext].map((s)=>[s,v]),
    observers: [...s.observers].map(<B>(_f:(v:A)=>B) => () => _f(v)),
    // PROPのアップデーターが残っていれば使用し、残っていないならガベージコレクト用にストリームからも消去。
    updates: [...s.updates].map((p) => PROP_UPDATER.has(p)
        ? () => (v:A) => PROP_UPDATER.get(p)!(v)
        : () => (_:A) => {s.updates.delete(p);clear(p)}
    )
})

/**
 * 二つのフロー状態を結合して単一のフロー状態とする
 * @param a 
 * @param b 
 * @returns 
 */
const concatFlowingState = <V>(a:FlowingState<V>, b:FlowingState<V>) => ({
    waiting: [...a.waiting, ...b.waiting],
    observers: [...a.observers, ...b.observers],
    updates: [...a.updates, ...b.updates]
});

/**
 * 時変値を受け取って指定のストリームからフローを開始、開始されたフロー状態を返す。
 * @param v 
 * @returns 
 */
const flow = <B>(v:B) => <A>(s:StreamState<A,B>) : FlowingState<A> => {
    try {
        const r = s[STREAM_FUNCTOR](v);
        return [...s.next]
            .filter(s => !s[STREAM_FILTER] || s[STREAM_FILTER](r))
            .map(flow(r))
            .reduce(concatFlowingState, streamToFlowingState(r)(s));
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
const flowLazy = <B>(v:B) => <A>(s:StreamState<A,B>) : FlowingState<A> => {
    const r = flow(v)(s);
    // マージされたストリームとはつながっていない
    if(!r.waiting.length) return r;
    
    // マージされたストリーム毎に、到着した値をリスト化する
    const m = new Map<StreamState<A,A[]>,A[]>();
    r.waiting.forEach(([s,v]) => {
        if(m.has(s))
            m.get(s)!.push(v);
        else
            m.set(s,[v]);
    });

    return [...m].map(([s,v])=>flowLazy(v)(s)).reduce(concatFlowingState, {
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
const drip = <A,B>(s: StreamState<A,B>) => (v:B) : FlowingState<A> => {
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
const merge = <A> (s:StreamState<A>[]) => (f:(a:A,b:A)=>A) : StreamState<A,A[]> => {
    // マージ後のストリーム
    const _s : StreamState<A,A[]> = stream((v:A[]) => {
        if(!v.length) throw new Error("No values have been merged yet.");
        return v.reduce(f);
    });
    s.forEach((s)=>s.lazyNext.add(_s));
    return _s;
};

/**
 * ストリームを分岐させる
 * @param s 
 * @returns 
 */
const pipe = <A>(s:StreamState<A>) => <B>(f:(v:A)=>B) => {
    if (typeof f !== 'function') {
        throw new TypeError('pipe function must be a function');
    }
    const _s = stream(f);
    s.next.add(_s);
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
const filter = <A>(s:Stream<A>) => <B extends A>(f:(v:A)=>boolean): StreamState<B,A> => {
    const _s = pipe(s)(parrot as (v:A)=>B);
    _s[STREAM_FILTER] = f;
    return _s;
}

/**
 * イベントストリームからプロパティを作る
 * @param s 
 * @returns 
 */
const hold = <A>(s:Stream<A>) => (v:A) : Prop<A> => {
    const p = ()=>v;
    s.updates.add(p);
    PROP_UPDATER.set(p, (_v:A)=>v=_v);
    return p;
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
 * 一つのイベントストリームから別の時変値のタイミングでサンプルを取る
 * @param s 
 * @returns 
 */
const snapshot = <A>(s:Stream<A>) => <B>(c:Prop<B>) : StreamState<B,A> => {
    const _s = stream(c);
    s.next.add(_s);
    return _s;
}

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
 * 時間の更新をイベントストリームとして取得する。
 */
type moments = {
    /**
     * 一定時間後、一回きりのタイムイベントを取得する
     * @param ms 
     * @returns 
     */
    timeout(ms:number) : Stream<number>
    /**
     * 一定間隔でタイムイベントを取得する
     * @param ms 
     * @returns 
     */
    interval(ms:number) : Stream<number>
    /**
     * 一定回数のフレーム更新を取得する
     * @param limit 
     * @returns 
     */
    framecount(limit:number) : Stream<number>
}

const moments = {} as moments; {

    const now: Prop<number> = performance.now.bind(performance);
    const elapsed = (t:number) => now() - t;

    moments.timeout = (ms:number = 0) => {
        const s = stream(elapsed);
        setTimeout(drip(s), ms, now());
        return s;
    };

    moments.interval = (ms: number = 0) => {
        const s = stream(elapsed);
        const pid = setInterval(drip(s), ms, now());
        listen(s)(()=>countRefs(s)<2 && clearInterval(pid));
        return s;
    };

    moments.framecount = typeof window.requestAnimationFrame === "function"
        ? (limit: number = Infinity) => {
            const n = now();
            const s = stream((t) => t - n);
            const c = limit === Infinity ? () => Infinity : accum(s)((_,s)=>s-1, limit);
            listen(s)(() => c()>0 && countRefs(s)>1 && requestAnimationFrame(drip(s)));
            requestAnimationFrame(drip(s));
            return s;
        }
        : (_:number) => {throw new Error('moments.framecount function need "requestAnimationFrame" function')};

}


export {stream,isStream,countRefs,clear,hold,accum,lift,merge,pipe,filter,snapshot,listen,drip,moments};

