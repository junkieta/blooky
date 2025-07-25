/**
 * blooky.ts
 * 関数型のリアクティブプログラミングをtypescriptで行うためのライブラリ。
 */

const STREAM_FILTER = Symbol("STREAM_FILTER");
const STREAM_CLEANER = Symbol("STREAM_CLEANER");
const PROP_RELATIONS = new WeakMap<Prop<any>,Stream<any>>();

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
    /**
     * イベント発生後に行うPROP更新
     */
    updates: Map<()=>A,(v:A)=>void>
    /**
     * イベントの発生を検知するオブザーバ
     */
    observers: Set<(v:A)=>void>
};

type MergedStream<A> = Stream<A> & { reducer: (a:A,b:A)=>A };

/**
 * 連結したストリームを辿り、受け取った時変値の処理関数をまとめる
 */
type FlowingState = {
    waiting: [MergedStream<any>,any][]
    observers: (()=>void)[]
    updates: (()=>void)[]
}

// 副作用の集合体
type Effect = Omit<FlowingState, "waiting"> & { created: number };

/**
 * 時変値を返す関数の型。
 */
type Prop<A> = {
    (): A
}

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
        s.observers.clear();
        s.updates.clear();
    }
};

// GCにあわせて参照を解除する
const cleanupRegistry = 
    window.FinalizationRegistry
    ? new FinalizationRegistry<WeakRef<Stream<any>|Prop<any>>>((ref) => {
        const v = ref.deref();
        if(!v) return;
        if(typeof v === "function") {
            if(PROP_RELATIONS.has(v))
                PROP_RELATIONS.get(v)!.updates.delete(v);
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
        observers: new Set(),
        updates: new Map(),
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
 * ストリームがオブザーバかプロパティによってどれだけ参照されているかを調べる
 * @param s 
 * @returns 
 */
const countReferences = <V>(s:Stream<V>, deep: boolean = false) : Prop<number> => {
    if(!isStream(s)) throw new TypeError("countRefs function is need Stream type");

    if(!deep) return () => s.observers.size + s.updates.size;

    return () => {
        const visited = new WeakSet<Stream<any>>();
        const stack: Stream<any>[] = [s];
        let count = 0;
        while (stack.length) {
            const current = stack.pop()!;
            if (visited.has(current)) continue;
            visited.add(current);
            count += current.updates.size + current.observers.size;
            stack.push(...current.next.keys(), ...current.lazyNext);
        }
        return count;
    };
}

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
        count += current.updates.size + current.observers.size;
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
const streamToFlowingState = <A>(v:A) => (s:Stream<A>) : FlowingState => ({
    waiting: [...s.lazyNext].map((s) => [s,v]),
    observers: [...s.observers].map((f) => ()=>f(v)),
    updates: [...s.updates.values()].map((p) => ()=>p(v))
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
const flow = <A>(v:A) => (s:Stream<A>) : FlowingState => {
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
const flowLazy = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const r = flow(v)(s);
    // マージされたストリームとはつながっていない
    if(!r.waiting.length) return r;
    // マージされたストリーム毎に、到着した値をリスト化する
    return [...new Map(r.waiting)].map(([s,v])=>flowLazy(v.reduce(s.reducer))(s)).reduce(concatFlowingState, { ...r, waiting: [] });
}

/**
 * 起点となるストリームに時変値を流し込み、関連するオブザーバの呼び出しと時変値の更新を行う。
 * @param s 
 * @returns 
 */
const drip = <A>(s: Stream<A>) => {
    if (drip.observerPhase) throw new Error('drip cannot be called during observer phase');
    const f = (v:A) => applyDripEffect(Object.assign(flowLazy(v)(s), { created: Date.now() }) as Effect);
    f.lazy = (v:A) => () => f(v);
    return f;
}

// 最終実行時間-エフェクトの生成後に何らかのエフェクトが実行されていた場合は、既に無効な呼び出しだとしてエラーにする
drip.lastExecuted = 0;

drip.observerPhase = false;

function applyDripEffect(effect: Effect) {
    if(drip.lastExecuted >= effect.created) throw new Error("effect expired error");
    drip.lastExecuted = effect.created;
    try {
        drip.observerPhase = true;
        effect.observers.forEach(f => f());
        drip.observerPhase = false;
        effect.updates.forEach(f => f());
    } catch (error) {
        drip.observerPhase = false;
        console.error('Error in drip function:', error);
        throw error;
    }
    return effect;
}


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
    _s[STREAM_CLEANER] = () => s.next.delete(s);
    s.next.set(_s, f);
    return _s;
}

/** Propにも対応したpipeのラッパ */
function map<A>(s:Stream<A>) : <B>(f:(v:A)=>B) => Stream<B>;
function map<A>(s:Prop<A>)        : <B>(f:(v:A)=>B) => Prop<B>;
function map<A>(s:Stream<A>|Prop<A>) {
    return typeof s !== "function"
        ? pipe(s)
        : !PROP_RELATIONS.has(s)
        ? <B>(f:(v:A)=>B) => f(s())
        : <B>(f:(v:A)=>B) => hold(pipe(PROP_RELATIONS.get(s)!)(f))(f(s()));
}

/**
 * 時変値に関数を適用して新しい時変値を作る
 * @param c 
 * @returns 
 */
const lift = <A>(c:Prop<any>[]) => (f:(p: any[])=>A) : Prop<A> => {
    // blookyのPROPならStreamを取り出す
    const s = c.map((p,i) => 
        PROP_RELATIONS.has(p)
            ? pipe(PROP_RELATIONS.get(p)!)((v)=>[[i,v]] as [number,any][])
            : null
    ).filter(Boolean) as Stream<[number,any][]>[];

    // blookyのPROPがなければfをラップするだけ
    if(!s.length)
        return ()=>f(c.map((f)=>f()));

    // Streamをマージした上でPropにする
    const merged = pipe(merge(s)((a,b)=>a.concat(b)))((u) => {
        const m = new Map(u);
        return f(c.map((p,i) => m.has(i) ? m.get(i)! : p()));
    });

    merged[STREAM_CLEANER] = () => {
        c.filter((p)=>PROP_RELATIONS.has(p)).forEach((p,i)=> PROP_RELATIONS.get(p)!.next.delete(s[i]));
    };

    return hold(merged)(f(c.map((f)=>f())));
}

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
    const p = () => v;
    s.updates.set(p, (_v)=>v=_v);
    PROP_RELATIONS.set(p, s);
    cleanupRegistry.register(p, new WeakRef(p));
    return p;
}

/**
 * イベントストリームにオブザーバーを登録する
 * Propが渡された場合は、即座に一度listenされる
 */
const listen = <A>(s:Stream<A>|Prop<A>) => function (f:(v:A)=>void, immediate = true) : ()=>void {
    if(typeof s !== "function") {
        s.observers.add(f);
        return s.observers.delete.bind(s.observers, f);
    }
    if(!PROP_RELATIONS.has(s))
        throw new Error("Prop is not registered:use hold function");
    const l = listen(PROP_RELATIONS.get(s)! as Stream<A>)(f);
    if(immediate) f(s());
    return l;
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
        const state = flowLazy(t)(globalTickStream);
        state.observers.forEach(f => f());
        state.updates.forEach(f => f());
        if(hasReferences(globalTickStream))
            requestAnimationFrame(tick);
    };

    moments.timeout = (ms:number = 0) => {
        if(!hasReferences(globalTickStream)) requestAnimationFrame(tick);
        const s = tickStateStream(({elapsed})=>ms <= elapsed);
        listen(s)(s.disconnect);
        return s;
    };

    moments.interval = (ms: number = 0) => {
        if(!hasReferences(globalTickStream)) requestAnimationFrame(tick);
        const s = tickStateStream(({deltaTime})=>deltaTime >= ms);
        const c = countReferences(s,true)() + 1;
        listen(s)(()=>{
            if(!hasReferences(s,c)) s.disconnect();
        });
        return s;
    };

    moments.framecount = typeof window.requestAnimationFrame === "function"
        ? (limit: number = Infinity) => {
            if(!hasReferences(globalTickStream)) requestAnimationFrame(tick);
            const s = tickStateStream(limit === Infinity ? undefined : ({count})=>count<=limit);
            if(limit) listen(s)(({count})=>{
                if(count===limit) s.disconnect();
            })
            return s;
        }
        : (_:number) => {throw new Error('moments.framecount function need "requestAnimationFrame" function')};

}

export {stream,isStream,countReferences,hasReferences,clear,hold,accum,lift,merge,pipe,map,filter,listen,drip,shed,moments};
export type {Stream,MergedStream,MomentState,MomentStream,Prop};
