/**
 * blooky-fp.ts
 * 関数型リアクティブプログラミングをTypeScriptで行うためのライブラリ。
 */
import { 
  DripPlan, DripperStream, FilterStream, FlowingState,
  MappedStream, MergedStream, Prop, PropPlan, Stream, Vertex 
} from "./blooky-fp-types";

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

const disconnect = (p: Prop<any>) => {
    PROP_UPDATE.delete(p);
    const s = PROP_FROM.get(p);
    if(!s) return;
    PROP_FROM.delete(p);
    if(!STREAM_PROP_RELATIONS.has(s)) return;
    const arr = STREAM_PROP_RELATIONS.get(s)!;
    arr.splice(arr.indexOf(p), 1);
    if(!arr.length) STREAM_PROP_RELATIONS.delete(s);
}


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

// filter用の内部ヘルパー
type Predicate<A> = A|RegExp|((v:A)=>boolean)|(()=>boolean);
const toPredicate = <A>(predicate: Predicate<unknown>) => 
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
const stream = <A>() : DripperStream<A> => {
    const s: DripperStream<A> = {
        next: new Set(),
        lazyNext: new Set(),
        isDripper: true
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
function map<A, B>(f: (v: A) => B): (s: Stream<A>) => MappedStream<A, B>;
function map<A, B>(p: Prop<B>): (s: Stream<A>) => MappedStream<A, B>;
function map<A, B>(value: B): (s: Stream<A>) => MappedStream<A, B>;

function map<A,B>(f:((v:A)=>B)|Prop<B>|B) {
    return (s:Stream<A>) : MappedStream<A,B> => {
        const _s: MappedStream<A,B> = {
            mapFn: typeof f === "function" ? f as (v:A)=>B : () => f,
            next: new Set(),
            lazyNext: new Set()
        };
        s.next.add(_s);
        STREAM_CLEANERS.set(_s, () => s.next.delete(_s));
        cleanupRegistry.register(_s, new WeakRef(_s));
        return _s;
    }
}

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
 * const result = pipe(stream<number>(),filter((n) => n > 0),map((n) => n * 2),hold(0)); // 0以上の数値が2倍になるProp
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
    isStream<A>(v) && v["isDripper"] === true;

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
    if(VERTEX_MAP.has(s)) return VERTEX_MAP.get(s)!;
    const v: Vertex = {
        sourceStream: s,
        get next() { return [...s.next].map(vertex) },
        get lazyNext() { return [...s.lazyNext].map(vertex) },
        get props() { return STREAM_PROP_RELATIONS.get(s) || [] }
    };
    VERTEX_MAP.set(s, v);
    return v;
}


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
const remap = <A,B>(f:(v:A)=>B) => (p:Prop<A>) : Prop<B> => 
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
  const streams : MappedStream<any,reservation[]>[] = 
    props.flatMap((p, i) => PROP_FROM.has(p) ? map((v) => [[i, v]] as reservation[])(PROP_FROM.get(p)!) : []);
  const mergedStream = merge<reservation[]>(streams, (a, b) => a.concat(b));
  const transformed = map((updates: reservation[]) => {
    const map = new Map(updates);
    return f(props.map((p, i) => map.has(i) ? map.get(i)! : p()));
  })(mergedStream);
  STREAM_CLEANERS.set(transformed, () => {
    streams.forEach((s)=>clear(s));
  });
  return hold(valueFn())(transformed);
};

// 内部実装用の関数群
const streamToFlowingState = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const waiting = [...s.lazyNext].map((s) => [s,v] as [MergedStream<A>,A]);
    if(!STREAM_PROP_RELATIONS.has(s)) return [[], waiting];
    const p = STREAM_PROP_RELATIONS.get(s)!;
    const plan: PropPlan<A>[] = p.map((prop)=>([prop,v]));
    return [plan,waiting];
}

const concatTuple = <T extends any[][]>(a: T, b: T): T => a.map((x, i) => x.concat(b[i])) as T;

const assertSyncValue = (v: any) => {
  if (v instanceof Promise) throw new Error("Promise is prohibited in blooky-fp v1.0.0");
};

const flow = <A>(v:A) => {
    assertSyncValue(v);
    return (s:Stream<A>) : FlowingState => {
        const state = streamToFlowingState(v)(s);
        const next = [...s.next].filter((s)=> !("filterFn" in s) || s.filterFn(v));
        return next.length
            ? next.map((_s) => {
                if(!("mapFn" in _s)) return flow(v)(_s);
                const _v = _s.mapFn(v); // 型推論はanyだが、_v は B (MappedStream<A,B>のB)
                assertSyncValue(_v);
                return flow(_v)(_s);
            }).reduce(concatTuple, state)
            : state;
    }
};

const flowLazy = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const r = flow(v)(s);
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
 * Dripperへの値注入によって生じるProp値の更新計画を返す
 * Data Flow:
 * ```
 * value + Dripper ──drip()──> DripPlan ──commit(plan)──> 実行
 * ```
 * 
 * @param value - 流し込む値
 * @returns データフローを経由して生成されるProp更新計画
 */
const drip = <A>({dripper,value}: DripPlan<A>) : PropPlan<any>[] => flowLazy(value)(dripper)[0];

/**
 * PropPlanの競合を収集する
 * @param plan 
 * @param equals 
 * @returns 
 */
const conflict = (plan: PropPlan<any>[]): Map<Prop<any>,any[]> => {
    const seen = new WeakMap<Prop<any>,any>();
    const result = new Map<Prop<any>,any[]>();
    for (const [p,v] of plan) {
        if(seen.has(p))
            result.set(p, result.has(p) ? result.get(p)!.concat(v) : [seen.get(p), v])
        else
            seen.set(p,v);
    }
    return result;
};

/**
 * 更新計画に基づいて値をPropに反映させる
 * @param plan 
 */
const commit = (plan: PropPlan<any>[]) => plan.forEach(([p,v]) => PROP_UPDATE.get(p)!(v));

export {
    // Core
    drip, conflict, commit, stream,
    // Stream operators
    merge, junction, map, filter,
    // Prop creators
    hold, accum, lift, remap,
    // Utilities
    pipe, clear, disconnect, vertex,
    // Type guards
    isStream, isDripperStream as isDripper, isDripperStream, isChainedProp, isVertex,
};

export type {
    Stream, Prop, DripperStream as Dripper, DripPlan
};