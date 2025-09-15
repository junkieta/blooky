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
  | { type: 'throttle', interval: number }
  | { type: 'batch', maxSize: number, merge: "latest"|"first"|(<A>(v:A[])=>A) }
  | { type: 'frame', budget: number, merge: "latest"|"first"|(<A>(v:A[])=>A) }  // 1フレーム当たりの実行予算

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
 
type Blueprint<A extends Object> = { [key in keyof A]: PropertyDescriptor };


export {
  Stream,Prop,DripperStream,FilterStream,MappedStream,MergedStream,
  DripStrategy,DripEffect,PropEffect,DripResult,
  FlowingState,StreamBase,
  Blueprint
}