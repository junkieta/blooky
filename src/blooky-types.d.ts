// src/blooky-store/types.ts
/**
 * ストリームの状態定義。次のストリームへの接続用情報を保持する。
 */
type StreamBase<A,T> = {
    /**
     * 連結されたストリーム
     */
    next: Set<MappedStream<any>|FilterStream<A>>
    /**
     * 連結先のうち、マージされる可能性のあるストリーム
     */
    lazyNext: Set<MergedStream<A>>
} & T;

type DripStrategy = 
  | { type: 'immediate' }  // デフォルト：即座実行
  | { type: 'debounce', delay: number }
  | { type: 'throttle', interval: number };
// DripStrategyのシンタックスシュガー
type ShortDripStrategy = 
  | { immediate: true }  
  | { debounce: number }
  | { throttle: number };

type DripperStream<A> = StreamBase<A, {
    dripStrategy: DripStrategy
}>
type MergedStream<A> = StreamBase<A,{
    reduceFn: (a:A,b:A)=>A
}>
type MappedStream<A> = StreamBase<A, {
    mapFn: <B>(v:B)=>A
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


type Vertex = {
    sourceStream: Stream<any>
    from?: Vertex
    next?: Vertex[]
    lazyNext?: Vertex[]
    props?: Prop<any>[]
};

/**
 * 連結したストリームを辿り、受け取った時変値の処理関数をまとめる
 */
type FlowingState = [PropEffect<unknown>[], [MergedStream<any>,any][]];


/**
 * 時変値を返す関数の型。
 */
type Prop<A> = ()=>A;

// Drip一回分のEffect
type DripEffect = {
  dripper: DripperStream<any>
  effects: Map<Prop<any>,any>;
}
// 各Propとその値を示す、最小のEffect。
type PropEffect<A> = [Prop<A>,A]

type DripResult<A,M="deny"> = M extends 'await'
  ? Promise<DripEffect>
  : DripEffect;
 
type CollapseObserver = 
  | 'immediate'    // 即座観測者
  | 'visual'       // 視覚観測者（RAF）
  | 'sequential'   // 順次観測者（timeout）
  | 'quantum'      // 量子観測者（microtask）
  | 'thrown'       // 理外観測者（error）


type CollapseReservation = {
    effect: DripEffect,
    resolve: (v:number)=>void,
    reject: (v:BlookyError<keyof BlookyErrorCauseMap>[])=>void
}

// エラー詳細の型定義
type DevConfigErrorCause = {
  missingKeys?: string[];
  duplicateHandlers?: string[];
  nodeType?: string;
  suggestions?: string[];
};

type StructureErrorCause = {
  expected: string;
  actual: string;
  value?: any;
  attribute?: string;
  suggestions?: string[];
};

type ConstraintErrorCause = {
  constraint: string;
  property?: string;
  context?: Record<string, any>;
  suggestions?: string[];
};

// fxエラー
type FlowErrorCause = {
  nodeType?: string;
  requiredContext?: string;
  currentContext?: string;
  suggestions?: string[];
};

type UserErrorCause = {
  originalError: Error|any;
  element?: Element;
  recoverable?: boolean;
  suggestions?: string[];
};

// エラーカテゴリのマップ
type BlookyErrorCauseMap = {
  'dev-config': DevConfigErrorCause;
  'structure': StructureErrorCause;
  'constraint': ConstraintErrorCause;
  'flow': FlowErrorCause;
  'user': UserErrorCause;
};

// ジェネリック型定義
type BlookyError<T extends keyof BlookyErrorCauseMap> = Error & {
    category: T;
    cause: {
        code: string;
    } & BlookyErrorCauseMap[T]
};

export {
  Stream,Prop,DripperStream,FilterStream,MappedStream,MergedStream,Vertex,
  DripStrategy,ShortDripStrategy,DripEffect,PropEffect,DripResult,
  FlowingState,StreamBase,
  CollapseObserver,
  CollapseReservation,
  BlookyError,BlookyErrorCauseMap,
  ConstraintErrorCause,DevConfigErrorCause,FlowErrorCause,StructureErrorCause,UserErrorCause,
}