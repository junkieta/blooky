/**
 * blooky-fp.ts
 * 関数型リアクティブプログラミングをTypeScriptで行うためのライブラリ。
 */
import { 
  CommitPlan,
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
 * Planがどのコミットから作成されたかを保管
 */
const COMMIT_PLAN_BASE = new WeakMap<CommitPlan,CommitPlan>();


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
    // 防衛的プログラミングを重視するなら `if (arr.indexOf(p) !== -1)` を挟む余地はある。
    // ただし、PROP_FROM と STREAM_PROP_RELATIONS の整合性が保たれている限り、
    // `indexOf(p)` は必ず有効な添字を返すため、ここでは不要とする。
    arr.splice(arr.indexOf(p), 1);
    if(!arr.length) STREAM_PROP_RELATIONS.delete(s);
}


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
 * 値を流し込むための「入り口」となるDripperStreamを生成する。
 * @returns 新しいDripper
 */
const stream = <A>() : DripperStream<A> =>
({
    next: new Set(),
    lazyNext: new Set(),
    isDripper: true,
});


/**
 * 複数のStreamを一つに合流させる。
 * いずれかのStreamに値が流れると、合流後のStreamにも値が流れる。
 * reduceFnで、複数の値をどう統合するかを指定できる。
 * @param streams - 合流させるStreamの配列
 * @param reduceFn - 値の統合方法（省略時は複数値同時到着をエラーとみなす）
 * @returns 合流後のStream
 */
const merge = <A> (s:Stream<A>[], f?:(v:A[]) => A) : MergedStream<A> => {
    const _s : MergedStream<A> = {
        next: new Set(),
        lazyNext: new Set(),
        reduceFn: f || ((v) => {
            if (v.length > 1)
                throw new MergeConflictError(_s, v);
            return v[0];
        })
    };
    STREAM_CLEANERS.set(_s, () => {
        s.forEach((s)=>s.lazyNext.delete(_s));
    });
    s.forEach((s)=>s.lazyNext.add(_s));
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
    assertSyncValue(f);
    return (s:Stream<A>) : MappedStream<A,B> => {
        const _s: MappedStream<A,B> = {
            mapFn: typeof f === "function" ? f as (v:A)=>B : () => f,
            next: new Set(),
            lazyNext: new Set()
        };
        s.next.add(_s);
        STREAM_CLEANERS.set(_s, () => s.next.delete(_s));
        return _s;
    }
}

/**
 * Prop<A>の値に応じて、異なるStreamを選択的に合流させる。
 * @param records - { key: Stream } の形式のレコードまたはMap。Mapとの互換性のため、Recordのsymbolキーは不許可。
 * @returns Propを受け取りMergedStreamを返す関数
 */
const junction = <A,B>(records: Map<A,Stream<B>>|Record<string|number,Stream<B>>) => {
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
    isStream<A>(v) && (v as any)["isDripper"] === true;

/**
 * 引数がDripPlanの要件を満たしているか判定。
 * @param v 
 * @returns 
 */
const isDripPlan = <A>(v:unknown) : v is DripPlan<A> => 
    Array.isArray(v) && v.length === 2 && isDripperStream(v[0]);

/**
 * PropがStreamから生成されたものかを判定。
 * @param v - 判定対象
 * @returns Streamと接続されたPropならtrue
 */
const isChainedProp = <A>(v: unknown): v is Prop<A> => PROP_UPDATE.has(v as Prop<A>);

/**
 * drip/steep/inverseのいずれかで生成されたCommitPlanかを判定する。
 * @param v 
 * @returns 
 */
const isCommitPlan = (v: unknown) : v is CommitPlan => COMMIT_PLAN_BASE.has(v as CommitPlan);

/**
 * StreamをVertex（グラフ構造）として表現したオブジェクトか判定する。
 * @param v - 判定対象
 * @returns Vertexならtrue
 */
const isVertex = (v: unknown) : v is Vertex =>  v ? isStream((v as Vertex).sourceStream) : false;

// memo
const VERTEX_MAP = new WeakMap<Stream<any>,Vertex>();

/**
 * Streamのデータフローをグラフ構造として安全に辿るための手段を提供する。
 * @param s - 変換するStream
 * @returns Vertex
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
    if(STREAM_PROP_RELATIONS.has(s))
        STREAM_PROP_RELATIONS.get(s)!.push(p);
    else
        STREAM_PROP_RELATIONS.set(s, [p]);
    return p;
}

/**
 * Propを元に別のPropを作成する。元のPropがStreamと接続されていれば、新しいPropも同じStreamから自動的に値を受け取る。
 * メモリ管理上の注意:
 * あくまで新規のPropであり、紐づけはStreamに対するもの。元のPropがdisconnectされても、remapされたPropは自動削除されない。
 * @param fn - 変換関数
 * @returns Propを受け取り新しいPropを返す関数
 */
const remap = <A,B>(f:(v:A)=>B) => (p:Prop<A>) : Prop<B> => 
    PROP_FROM.has(p)
        ? hold(f(p()))(map(f)(PROP_FROM.get(p)!))
        : ()=>f(p());

/**
 * 複数のPropを組み合わせて新しいPropを生成。いずれかのPropが更新されると、新しいPropも自動的に再計算される。
 * メモリ管理上の注意:
 * remapと同様、liftのPropは元となるPropがdisconnectされても影響を受けない。disconnectされたPropはただのゲッター関数である。
 * @param fn - 統合関数
 * @returns Props配列を受け取り新しいPropを返す関数
 */
function lift<V, T extends any[]>(
  f: (values: T) => V, 
  props: { [K in keyof T]: Prop<T[K]> }
): Prop<V> {
  type reservation = [number, any];
  const valueFn = () => f(props.map(p => p()) as T);
  const streams : MappedStream<any,reservation[]>[] = 
    props.flatMap((p, i) => PROP_FROM.has(p) ? map((v) => [[i, v]] as reservation[])(PROP_FROM.get(p)!) : []);
  const mergedStream = merge<reservation[]>(streams, (v) => v.flat());
  const transformed = map((updates: reservation[]) => {
    const map = new Map(updates);
    return f(props.map((p, i) => map.has(i) ? map.get(i)! : p()) as T);
  })(mergedStream);
  STREAM_CLEANERS.set(transformed, () => {
    streams.forEach((s)=>clear(s));
  });
  return hold(valueFn())(transformed);
};

// 内部実装用
export class CommitConflictError extends Error {
  name = "CommitConflictError";
  constructor(readonly conflicts: Map<Prop<any>, any[]>) {
    super("Conflict in CommitPlan");
  }
}

export class MergeConflictError<A> extends Error {
  name = "MergeConflictError";
  
  constructor(readonly stream: MergedStream<A>, conflicts: A[]) {
    super("Conflict in MergedStream");
  }
}

const streamToFlowingState = <A>(v:A) => (s:Stream<A>) : FlowingState => {
    const waiting = [...s.lazyNext].map((s) => [s,v] as [MergedStream<A>,A]);
    if(!STREAM_PROP_RELATIONS.has(s)) return [[], waiting];
    const p = STREAM_PROP_RELATIONS.get(s)!;
    const plan: PropPlan<A>[] = p.map((prop)=>([prop,v]));
    return [plan,waiting];
}

const concatTuple = <T extends any[][]>(a: T, b: T): T => a.map((x, i) => x.concat(b[i])) as T;

const assertSyncValue = (v: any) => {
  if (v instanceof Promise) throw new Error("[blooky-fp]Promise is prohibited in blooky-fp v1.0.0");
};

const flow = <A>([s,v]: [Stream<A>,A]): FlowingState => {
    assertSyncValue(v);
    const state = streamToFlowingState(v)(s);
    const next = [...s.next].filter((s)=> !("filterFn" in s) || s.filterFn(v));
    return next.length
        ? next.map((_s) => flow([_s, "mapFn" in _s ? _s.mapFn(v) : v])).reduce(concatTuple, state)
        : state;
}

const flowLazy = <A>(plan:[Stream<A>,A]) : FlowingState => {
    const r = flow(plan);
    const [updates,waiting] = r;
    if(!waiting.length) return r;
    const m = waiting.reduce(tuplesToMapReducer, new Map<MergedStream<any>,any[]>());
    return [...m].map(([s,v])=>flowLazy([s, s.reduceFn(v)])).reduce(concatTuple, [updates,[]]);
}

const tuplesToMapReducer = <K,V>(map: Map<K,V[]>, [key,value]: [K,V]) => {
    if(!map.has(key)) {
        map.set(key, [value]);
    } else {
        map.get(key)!.push(value);
    }
    return map;
};



// 最終コミット
const latestCommitPlan = hold<CommitPlan>([])(stream());

/**
 * Dripperへの値注入によって生じるProp値の更新計画を返す
 * Data Flow:
 * ```
 * Dripper + value ──drip()──> DripPlan ──commit(plan)──> 実行
 * ```
 * 
 * @param value - 流し込む値
 * @returns データフローを経由して生成されるProp更新計画
 */
const drip = <A>(plan: DripPlan<A>): CommitPlan => {
    if (!isDripPlan(plan)) throw new Error("[blooky-fp] drip: invalid plan");
    const commits = flowLazy(plan)[0];
    COMMIT_PLAN_BASE.set(commits, latestCommitPlan());
    return commits;
}

/**
 * dripとは違い、同時到着の値を処理するための浸漬式更新計画を返す
 * Data Flow:
 * ```
 * [Dripper + value][] ──drip()──> DripPlan ──commit(plan)──> 実行
 * ```
 * 
 * @param plans 浸漬させる値のリスト
 * @returns データフローを経由して生成されるProp更新計画
 */
const steep = (plans: DripPlan<any>[]) : CommitPlan => {
    if(!plans.length) throw new Error("[blooky-fp] steep: empty plans");
    if(plans.length < 2) return drip(plans[0]);

    // Kahn's アルゴリズムでトポロジカルソートする
    const [nextCommitPlan, waiting] = plans.map(flow).reduce(concatTuple,[[],[]] as FlowingState);
    COMMIT_PLAN_BASE.set(nextCommitPlan, latestCommitPlan());
    if(!waiting.length) return nextCommitPlan;

    const pendingValues = waiting.reduce(tuplesToMapReducer, new Map<MergedStream<any>,any[]>());
    const mergedStreamArr = [...pendingValues.keys()];
    const isDownStream = ((set)=>set.has.bind(set))(new Set(mergedStreamArr));

    const dependents = new Map<MergedStream<any>, MergedStream<any>[]>();
    const inDegree = new Map(mergedStreamArr.map((s)=>[s,0]));

    mergedStreamArr.forEach((ms)=>{
        // next 経由で到達できる lazyNext を下流として登録
        const downStream = new Set<MergedStream<any>>();
        // グラフを辿って lazyNext を取得
        (function find(this: Set<MergedStream<any>>, {lazyNext,next}: Stream<any>) {
            [...lazyNext].filter(isDownStream).forEach((s)=>this.add(s));
            next.forEach(find, this);
        }).call(downStream, ms);

        if(!downStream.size) return;

        // MergedStream同士の依存関係を保存
        if(!dependents.has(ms))
            dependents.set(ms, [...downStream]);
        else
            dependents.get(ms)!.push(...downStream);
        // 次数管理
        downStream.forEach((d) => inDegree.set(d, inDegree.get(d)! + 1));
    });

    // 次数を元にソート
    const queue = mergedStreamArr.filter(v => inDegree.get(v) === 0);
    const sorted: MergedStream<any>[] = [];
    while (queue.length) {
        const ms = queue.shift()!;
        sorted.push(ms);
        for (const dep of (dependents.get(ms) ?? [])) {
            const next = inDegree.get(dep)! - 1;
            inDegree.set(dep, next);
            if (next === 0) queue.push(dep);
        }
    }

    // 循環参照検出
    if (sorted.length < mergedStreamArr.length)
        throw new Error("[blooky-fp] steep: circular dependency detected");

    // トポロジカル順に MergedStream を解決
    const walk = <A>([s,v]: [Stream<A>,A]) => {
        assertSyncValue(v);
        if(STREAM_PROP_RELATIONS.has(s))
            nextCommitPlan.push(...STREAM_PROP_RELATIONS.get(s)!.map((p)=>[p,v] as [Prop<A>,A]));
        // lazyNext への値を pendingValues に追記
        s.lazyNext.forEach((ms) => {
            if (pendingValues.has(ms)) pendingValues.get(ms)!.push(v);
            else pendingValues.set(ms, [v]);
        });
        [...s.next]
            .filter((s) =>!("filterFn" in s) || s.filterFn(v))
            .forEach((s) => walk([s, "mapFn" in s ? s.mapFn(v) : v]));
    };
    sorted.forEach((ms)=>{
        const values = pendingValues.get(ms);
        if (values?.length) walk([ms, values.reduce(ms.reduceFn)]);
    });

    return nextCommitPlan;
}



/**
 * CommitPlanから逆向きの状態遷移を取得する。
 * @param plan 
 * @returns CommitPlan
 */
const inverse = (plan: CommitPlan) : CommitPlan => {
    const base = COMMIT_PLAN_BASE.get(plan);
    if (!base)
        throw new Error("[blooky-fp] inverse: foreign or stale plan");
    if (COMMIT_PLAN_BASE.has(base))
        throw new Error("[blooky-fp] inverse: cannot inverse an already-inversed plan");
    const inverse = plan.map(([p])=>[p,p()]) as CommitPlan;
    COMMIT_PLAN_BASE.set(inverse, plan);
    return inverse;
}

// commitから内部的に呼ぶconflictチェック
const assertNoConflict = (plan: CommitPlan) => {
    const seen = new Map<Prop<any>, any>();
    for (const [p, v] of plan) {
        if (seen.has(p) && !Object.is(seen.get(p), v)) {
            throw new CommitConflictError(new Map([[p, [seen.get(p), v]]]));
        }
        seen.set(p, v);
    }
};

/**
 * 更新計画に基づいて値をPropに反映させる
 * @param plan 
 * @returns void
 */
const commit = (plan: CommitPlan) => {
    assertNoConflict(plan);
    // ChainedProp以外はNG
    if(plan.some(([p])=>!PROP_UPDATE.has(p)))
        throw new Error("[blooky-fp] commit: chained prop only");

    // 紐づけが存在し、現在の lastCommittedPlan と一致しない場合は設計違反
    const base = COMMIT_PLAN_BASE.get(plan);
    if (base !== latestCommitPlan())
        throw new Error("[blooky-fp] commit: plan is stale");

    // Planの全てのPropを設定
    plan.forEach(([p,v]) => PROP_UPDATE.get(p)!(v));

    // baseにbaseが存在するのはinversedなので、latestをさらに前のCommitPlanにする
    const latest = COMMIT_PLAN_BASE.has(base)
        ? COMMIT_PLAN_BASE.get(base)
        : plan;

    // latestCommitPlanを更新(今のところは非公開Propのため直接setterを呼んでいる)
    PROP_UPDATE.get(latestCommitPlan)!(latest);
}

export {
    // Core
    drip, steep, commit, inverse, stream,
    // Stream operators
    merge, junction, map, filter,
    // Prop creators
    hold, accum, lift, remap,
    // Utilities
    pipe, clear, disconnect, vertex,
    // Type guards
    isStream,
    isDripperStream as isDripper,
    isDripperStream,
    isDripPlan,
    isCommitPlan,
    isChainedProp,
    isVertex,
};

export const utils = {
    isStream,
    isDripper: isDripperStream,
    isDripperStream,
    isDripPlan,
    isCommitPlan,
    isChainedProp,
    isVertex,
    concatTuple,
    tuplesToMapReducer
}

export type {
    Stream, Prop, DripperStream as Dripper, DripPlan, CommitPlan
};