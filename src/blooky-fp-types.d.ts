// blooky-fp types (core)

export type Prop<A> = () => A;

export type StreamBase<A, T> = {
  next: Set<MappedStream<A,any> | FilterStream<A>>;
  lazyNext: Set<MergedStream<A>>;
} & T;

export type DripperStream<A> = StreamBase<A, { isDripper: true }>;
export type Dripper<A> = DripperStream<A>;

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

// Informative / internal
export type FlowingState = [PropPlan<unknown>[], [MergedStream<any>, any][]];
