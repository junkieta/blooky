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
 

//A. 開発時設定エラー（Development Configuration Errors）
//特徴: 開発者のコード記述ミス、設定不備によるもの
type DevConfigError = {
    category: 'dev-config';
    code: string;
    message: string;
    suggestions?: string[];
}

//B. 型・構造エラー（Type/Structure Errors）
//特徴: オブジェクトの型や構造が期待と異なる
type StructureError = {
    category: 'structure';
    code: string;
    expected: string;
    actual: string;
    value?: any;
}

//C. ランタイム制約エラー（Runtime Constraint Errors）
//特徴: 実行時の制約違反、プロパティアクセス制限など
type ConstraintError = {
    category: 'constraint';
    code: string;
    constraint: string;
    context?: Record<string, any>;
}

//D. フロー制御エラー（Flow Control Errors）
//特徴: 実行フローの文脈や状態に関する制約違反
type FlowError = {
    category: 'flow';
    code: string;
    requiredContext: string;
    currentContext?: string;
}

//E. ユーザー起因エラー（User-Triggered Errors）
//特徴: Promise拒否など、アプリケーション実行中に発生する可能性があるもの
type UserError = {
    category: 'user';
    originalError: any;
    element?: Element;
    recoverable: boolean;
}


export {
  Stream,Prop,DripperStream,FilterStream,MappedStream,MergedStream,
  DripStrategy,DripEffect,PropEffect,DripResult,
  FlowingState,StreamBase,
  DevConfigError,
  StructureError,
  ConstraintError,
  FlowError,
  UserError
}