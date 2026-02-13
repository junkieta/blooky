// blooky-fp types (core)

export type Prop<A> = () => A;

export type StreamBase<A, T> = {
  next: Set<MappedStream<A,any> | FilterStream<A>>;
  lazyNext: Set<MergedStream<A>>;
} & T;

export type DripperStream<A> = StreamBase<A, { isDripper: true }>;

export type MergedStream<A> = StreamBase<A, { reduceFn: (a: A, b: A) => A }>;

export type MappedStream<A,B> = StreamBase<B, { mapFn: (v: A) => B }>;

export type FilterStream<A> = StreamBase<A, { filterFn: (v: A) => boolean }>;

export type Stream<A> =
  | DripperStream<A>
  | MappedStream<any,A>
  | MergedStream<A>
  | FilterStream<A>;


// Informative / Introspection
export type Vertex = {
  sourceStream: Stream<any>;
  next: Vertex[];
  lazyNext: Vertex[];
  props: Prop<any>[];
};


export type PropPlan<A> = [Prop<A>, A];
export type DripPlan = PropPlan<any>[];

export type BlendConflict = {
  prop: Prop<any>;
  values: any[];
};

export type BlendOptions = {
  // 値が同一と見なせるか（デフォルト Object.is）
  equals?: (a: any, b: any) => boolean;
  // 競合時の解決規則。未指定なら conflict 扱い。
  resolve?: (prev: any, next: any, prop: Prop<any>) => any;
};

export type BlendResult =
  | { ok: true; plan: DripPlan }
  | { ok: false; conflicts: BlendConflict[] };

// Informative / internal
export type FlowingState = [PropPlan<unknown>[], [MergedStream<any>, any][]];
