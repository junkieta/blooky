// 型定義
import { DripperStream, Prop, Stream } from "../blooky-fp";

// --- 汎用的な型定義 ---

/**
 * 全てのFxNodeの基底となる型
 */
type FxNodeBase<T extends string, P = {}> = P & {
  type: T;
  id?: string;
};

/**
 * 実行時にコンテキストから値を解決するための参照オブジェクト、または値そのもの
 */
type FxRef<T> = { [key: symbol]: true; key: string; } | Prop<T> | T;

/**
 * dispatchノードが受け取る設定オブジェクトの型
 */
type FxDispatchSettings<A> = CustomEventInit<A> & {
  target: string | EventTarget;
};


// --- FxNodeの定義 ---

// 各ノードの型を個別に定義
type FxNoneNode = FxNodeBase<"none">;
type FxSequenceNode = FxNodeBase<"sequence", { steps: FxNode[] }>;
type FxParallelNode = FxNodeBase<"parallel", { steps: FxNode[] }>;
type FxRaceNode = FxNodeBase<"race", { steps: FxNode[] }>;
type FxWaitNode = FxNodeBase<"wait", { ms?: FxRef<number>, until?: FxRef<Prop<boolean>> }>; // waitの拡張を反映
type FxLoopNode = FxNodeBase<"loop", { cond: FxRef<boolean>, body: FxNode }>;
type FxConditionNode = FxNodeBase<"condition", { if: FxRef<boolean>, then: FxNode, else?: FxNode }>;
type FxSwitchNode = FxNodeBase<"switch", { by: FxRef<string | number | symbol>, cases: Map<string | number | symbol, FxNode>, default?: FxNode }>;
type FxCallNode = FxNodeBase<"call", { action: FxRef<(v: any) => unknown>, arg?: FxRef<any>, context?: FxRef<any>, catcher?: FxRef<(error: Error) => unknown> }>;
type FxCollapseNode = FxNodeBase<"collapse", { dripper: FxRef<DripperStream<any>>, value: FxRef<any>, catcher?: FxRef<(error: Error) => unknown>, promise?: FxRef<"deny" | "allow" | "await"> }>;
type FxDispatchNode = FxNodeBase<"dispatch", { name: FxRef<string>, settings: FxDispatchSettings<FxRef<any>>, child?: FxNode }>;
type FxYieldNode = FxNodeBase<"yield", { for: string, value: FxRef<any>, id?: string }>; // yieldの拡張を反映

/**
 * ユーザーが定義する、コンパイル前の副作用フローのノードを表す合併型
 */
type FxNode =
  | FxNoneNode
  | FxSequenceNode
  | FxParallelNode
  | FxRaceNode
  | FxWaitNode
  | FxLoopNode
  | FxConditionNode
  | FxSwitchNode
  | FxCallNode
  | FxCollapseNode
  | FxDispatchNode
  | FxYieldNode;

/**
 * 全てのFxNode定義が実装すべき規約
 */
interface INodeDefinition<T extends FxNode['type']> {
  /**
   * ノードの種類を示す一意な文字列
   */
  readonly type: T;

  /**
   * ユーザーがフローを構築するためのファクトリ関数 (例: fx.call)
   * @param args ファクトリ関数が受け取る引数
   */
  factory(...args: any[]): Extract<FxNode, { type: T }>;

  /**
   * runジェネレータに、次に実行すべきノードを案内する。
   * @param context 実行コンテキスト (ifの条件評価などに使用)
   */
  step(
    context: FxExecutionContext & { node: Extract<FxNode, { type: T }> }
  ): Generator<FxNode, any, any>;
  
  /**
   * ノードを実行するハンドラ
   * @param context 実行コンテキスト
   */
  handle(
    context: FxExecutionContext & { node: Extract<FxNode, { type: T }> }
  ): Promise<any>;

}


/**
 * エフェクト実行エンジンが要求するコンテキストの機能。
 */
type AppContext = Record<string, any>;

type CancelToken = {
  parent?: CancelToken
  cancel: () => void;
  cancelled: () => boolean
};


type FxHandlerMap = {
  [K in FxNode["type"]]?: (
    ctx: FxExecutionContext & { node: Extract<FxNode, { type: K }> }
  ) => Promise<any>
};

type FxFactoryMap = {
  [K in FxNode["type"]]: (...args: any[]) => Extract<FxNode, { type: K }>
};


// 実行全体の設定
interface ExecContext {
  resolve: <A>(v:FxRef<A>)=>Prop<A>;
  cancelToken: CancelToken;
  middlewares?: FxMiddleware[];
  onNodeEnter?: (node: FxNode) => void;
  onNodeExit?: (node: FxNode, result?:any, error?: Error) => void;
  runtimeState$: DripperStream<FxResult>; // 結果報告用
  yieldChannel?: (req:YieldRequest) => void
  pendingYieldReject?: (reason?: any) => void
}

// ミドルウェアに渡される、各ステップの情報
interface FxExecutionContext {
  node: FxNode;
  context: ExecContext
  appContext: AppContext
  run: (n:FxNode)=>Generator<FxNode, void, any>
  execute: (n:FxNode)=>Promise<AppContext>
}

// Middlewareの関数型
type FxMiddleware = (
  ctx: FxExecutionContext,
  next: () => Promise<any> // 次のMiddlewareを呼び出すための関数
) => Promise<any>;


/**
 * 実行準備が完了した副作用フローを表すオブジェクト。
 * prepare関数によって生成され、execute関数に渡される。
 */
interface PreparedFx {
  readonly rootNode: FxNode
  readonly execContext: ExecContext
  readonly appContext: AppContext // プロキシされたコンテキスト
}

/**
 * 実行中の副作用フローを制御し、結果を消費するためのハンドル。
 */
interface ExecutionHandle {
  /**
   * フローの実行をキャンセルする。
   */
  cancel: () => void;

  /**
   * フローが生成するid付きの結果をプッシュ型で受け取るためのStream。
   * UIのリアルタイム更新など、宣言的なリアクティブ連携に最適。
   */
  results$: Stream<FxResult>;

  /**
   * フローの結果をプル型で、逐次的に取得するための非同期ジェネレータ。
   * `fx.yield`を使った対話的なフローに利用できる。
   */
  fetch(): AsyncGenerator<YieldRequest, void, any>;

  /**
   * 実行の完了を知らせるPromise
   */
  done: Promise<AppContext>

  /**
   * fetchで解決しきらない場合は明示的に呼ぶこと。
   */
  close:  (finalValue?: any) => void
  
}



/**
 * 副作用フローの実行結果を表す、idと値のペア。
 */
type FxResult = {
  id: string; // 結果を生成したFxNodeのid
  value: any; // 結果の値
};

// yieldからdispatchされる型
type YieldRequest = {
  id?: string; // 結果を生成したFxNodeのid
  for?: string;
  value: any; // 結果の値
  resolve: (response: any) => void;
}


/**
 * 各ファクトリ関数 (fx.call, fx.sequenceなど) の引数の型を定義するスキーマ
 * [必須引数1, 必須引数2, オプション引数?, ...] のようにタプルで記述する
 */
type FxFactoryArgs = {
  none: [],
  sequence: [steps: FxNode[]],
  parallel: [steps: FxNode[]],
  race: [steps: FxNode[]],
  wait: [options: { ms?: FxRef<number>, until?: FxRef<boolean> }],
  loop: [cond: FxRef<boolean>, body: FxNode],
  condition: [ifCond: FxRef<boolean>, thenBranch: FxNode, elseBranch?: FxNode],
  switch: [by: FxRef<any>, cases: Map<any, FxNode>, defaultNode?: FxNode],
  call: [
    action: FxRef<(v: any) => unknown>,
    options?: { arg?: FxRef<any>, context?: FxRef<any>, catcher?: FxRef<(e: Error) => unknown>, id?: string }
  ],
  collapse: [
    value: FxRef<any>,
    dripper: FxRef<DripperStream<any>>,
    options?: { catcher?: FxRef<(e: Error) => unknown>, mode?: FxRef<any>, promise?: FxRef<any> }
  ],
  dispatch: [name: FxRef<string>, settings: FxDispatchSettings<FxRef<any>>, child?: FxNode],
  yield: [options: { for: FxRef<string>, value: FxRef<any>, id?: string }],
};

/**
 * FxFactoryArgsスキーマを元に、fxオブジェクトの完全な型を生成する
 */
type FxFactory = {
  // FxFactoryArgs の各キー (none, sequence, call...) をループ処理する
  [K in keyof FxFactoryArgs]: (
    // 各キーに対応する引数タプルを展開して、関数の引数リストにする
    ...args: FxFactoryArgs[K]
  ) =>
    // 戻り値の型は、FxNodeの中からtypeがKであるものを抜き出して設定する
    Extract<FxNode, { type: K }>
};

export {
    FxFactoryArgs,
    FxFactory,
    FxNodeBase,
    FxNode,
    FxNoneNode,
    FxSequenceNode,
    FxParallelNode,
    FxRaceNode,
    FxWaitNode,
    FxLoopNode,
    FxConditionNode,
    FxSwitchNode,
    FxCallNode,
    FxCollapseNode,
    FxDispatchNode,
    FxYieldNode,

    FxRef,
    INodeDefinition,
    FxDispatchSettings,
    FxHandlerMap,FxMiddleware,FxFactoryMap,
    PreparedFx,ExecutionHandle,
    FxResult,YieldRequest,
    AppContext,CancelToken,ExecContext,FxExecutionContext,
};