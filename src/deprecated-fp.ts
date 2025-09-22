
/**
 * ストリームがプロパティによってどれだけ参照されているかを調べる
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


// dripと同様の処理を、全ての関連フローを記録してグラフ生成する
// 高負荷になるので、データフロー履歴が欲しい場面でだけ使用する
const dripGraph = <A>(value: A) => (dripper: DripperStream<A>) : DripEffect & { streams: Map<Stream<any>,any> } => {
    const lazy = new Map<MergedStream<any>,any[]>();
    const streams = new Map<Stream<any>, any>();
    const effects = new Map<Prop<any>,any>();
    const walk = (v:any) => (s:Stream<any>) => {
        streams.set(s,v);
        STREAM_PROP_RELATIONS.get(s)?.forEach((p)=>effects.set(p, v));
        if(s.lazyNext.size) s.lazyNext.forEach((s)=>{
            if(lazy.has(s))
                lazy.get(s)!.push(v);
            else
                lazy.set(s, [v]);
        });
        if(s.next.size) [...s.next]
            .filter((s) => !("filterFn" in s) || s.filterFn(v))
            .forEach((s) => walk("mapFn" in s ? s.mapFn(v) : v)(s));
    };

    walk(value)(dripper);
    while(lazy.size) {
        const entries = [...lazy];
        lazy.clear();
        entries.forEach(([s,v])=>walk(v.reduce(s.reduceFn))(s));
    }

    return { dripper, streams, effects };
}


// メソッドチェーン風のストリーム構築をサポートするかどうか。以下は試案。
// 高階関数の引数順を入れ替えて、メソッドチェーン的な書き味に
type StreamOperators<A> = {
    value: Stream<A>
    map: <B>(f:((v:A)=>B)|Prop<B>|B) => StreamOperators<B>,
    filter: (f:((v:A)=>boolean)|RegExp|A) => StreamOperators<A>,
    hold: (v:A) => PropOperators<A>,
    accum: <S>(f:(s:S,v:A)=>S,s:S) => PropOperators<S>,
    drip?: <M extends 'deny' | 'allow' | 'await' = 'deny'>(value:A, options?: { acceptPromise?: M }) => DripResult<A,M>
}
type PropOperators<A> = {
    value: ()=>A
    remap: <B>(f:(v:A,p?:A)=>B) => PropOperators<B>,
    when: (predicate: (v: A) => boolean) => PropOperators<A|typeof NotThen>,
    then?: PromiseLike<A>["then"]
}

const streamOp = <A>(_s:Stream<A> = stream()) : StreamOperators<A> => ({
    value: _s,
    map: <B>(f:((v:A)=>B)|Prop<B>|B) => streamOp(map(f)(_s)),
    filter: (f:((v:A)=>boolean)|RegExp|A) => streamOp(filter(f)(_s)),
    hold: (v:A) => propOp(hold(v)(_s)),
    accum: <S>(f:(s:S,v:A)=>S,s:S) => propOp(accum(f,s)(_s)),
    ...(isDripperStream(_s) ? {
        drip: <M extends 'deny' | 'allow' | 'await' = 'deny'>(value:A, options?: { acceptPromise?: M }) => drip(value,options)(_s)
    } : {})
})

streamOp.merge = <A>(s:(Stream<A>|StreamOperators<A>)[], f?:(a:A,b:A)=>A) : StreamOperators<A> =>
    streamOp(merge(s.map((s)=>isStream<A>(s) ? s : s.value), f));

const propOp = <A>(prop:Prop<A> | (Prop<A> & PromiseLike<A>)) : PropOperators<A> => ({
    value: prop,
    remap: <B>(f:(v:A,p?:A)=>B) => propOp(remap(f)(prop)),
    when: (predicate:(v:A)=>boolean) => propOp(when(predicate)(prop)),
    ...("then" in prop ? { then: prop.then.bind(prop) } : {})
});

propOp.lift = <A>(props: (Prop<any>|PropOperators<any>)[], f: (values: any[]) => A) : PropOperators<A> =>
    propOp(lift(f)(props.map((p) => isChainedProp<any>(p) ? p : p.value )));

export {
    streamOp, propOp
}
