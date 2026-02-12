// blooky-fp types (core)

export type Prop<A> = () => A;

export type PropEffect<A> = [Prop<A>, A];

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

export type DripEffect<A> = {
  value: A;
  dripper: DripperStream<A>;
  effects: Map<Prop<any>, any>;
};

// Informative / Introspection
export type Vertex = {
  sourceStream: Stream<any>;
  next: Vertex[];
  lazyNext: Vertex[];
  props: Prop<any>[];
};

// Informative / internal
export type FlowingState = [PropEffect<unknown>[], [MergedStream<any>, any][]];
