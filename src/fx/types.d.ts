
//
// 型定義

import { DripperStream, Prop, Stream } from "../blooky";


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
type FxWaitNode = FxNodeBase<"wait", { ms?: FxRef<number>, until?: FxRef<boolean> }>; // waitの拡張を反映
type FxLoopNode = FxNodeBase<"loop", { cond: FxRef<boolean>, body: FxNode }>;
type FxConditionNode = FxNodeBase<"condition", { if: FxRef<boolean>, then: FxNode, else?: FxNode }>;
type FxSwitchNode = FxNodeBase<"switch", { by: FxRef<string | number | symbol>, cases: Map<string | number | symbol, FxNode>, default?: FxNode }>;
type FxCallNode = FxNodeBase<"call", { action: FxRef<(v: any) => unknown>, arg?: FxRef<any>, context?: FxRef<any>, catcher?: FxRef<(error: Error) => unknown> }>;
type FxDripNode = FxNodeBase<"drip", { stream: FxRef<DripperStream<any>>, value: FxRef<any>, catcher?: FxRef<(error: Error) => unknown>, mode?: FxRef<"saga" | "atomic">, promise?: FxRef<"deny" | "allow" | "await"> }>;
type FxDispatchNode = FxNodeBase<"dispatch", { name: FxRef<string>, settings: FxDispatchSettings<FxRef<any>>, child?: FxNode }>;
type FxTakeNode = FxNodeBase<"take", { stream: FxRef<Stream<any>> }>;
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
  | FxDripNode
  | FxDispatchNode
  | FxTakeNode
  | FxYieldNode;


// --- FxCompiledNodeの定義 ---

// コンパイル後の各ノードの型を定義
type FxCompiledNodeBase<T extends string, P = {}> = FxNodeBase<T, P>;

type FxCompiledNoneNode = FxCompiledNodeBase<"none">;
type FxCompiledSequenceNode = FxCompiledNodeBase<"sequence", { steps: FxCompiledNode[] }>;
type FxCompiledParallelNode = FxCompiledNodeBase<"parallel", { steps: FxCompiledNode[] }>;
type FxCompiledRaceNode = FxCompiledNodeBase<"race", { steps: FxCompiledNode[] }>;
type FxCompiledWaitNode = FxCompiledNodeBase<"wait", { ms?: Prop<number>, until?: Prop<boolean> }>;
type FxCompiledLoopNode = FxCompiledNodeBase<"loop", { cond: Prop<boolean>, body: FxCompiledNode }>;
type FxCompiledConditionNode = FxCompiledNodeBase<"condition", { if: Prop<boolean>, then: FxCompiledNode, else?: FxCompiledNode }>;
type FxCompiledSwitchNode = FxCompiledNodeBase<"switch", { by: Prop<string | number | symbol>, cases: Map<string | number | symbol, FxCompiledNode>, default?: FxCompiledNode }>;
type FxCompiledCallNode = FxCompiledNodeBase<"call", { action: (v: any) => unknown, arg?: Prop<any>, context?: Prop<any>, catcher?: (error: Error) => unknown }>;
type FxCompiledDripNode = FxCompiledNodeBase<"drip", { stream: Prop<DripperStream<any>>, value: Prop<any>, catcher?: (error: Error) => unknown, mode?: Prop<"saga" | "atomic">, promise?: Prop<"deny" | "allow" | "await"> }>;
type FxCompiledDispatchNode = FxCompiledNodeBase<"dispatch", { name: Prop<string>, settings: FxDispatchSettings<Prop<any>>, child?: FxCompiledNode }>;
type FxCompiledTakeNode = FxCompiledNodeBase<"take", { stream: Prop<Stream<any>> }>;
type FxCompiledYieldNode = FxCompiledNodeBase<"yield", { for: string, value: Prop<any>, id?: string }>;

/**
 * コンパイラによってFxRefが解決された、実行可能なノードを表す合併型
 */
type FxCompiledNode =
  | FxCompiledNoneNode
  | FxCompiledSequenceNode
  | FxCompiledParallelNode
  | FxCompiledRaceNode
  | FxCompiledWaitNode
  | FxCompiledLoopNode
  | FxCompiledConditionNode
  | FxCompiledSwitchNode
  | FxCompiledCallNode
  | FxCompiledDripNode
  | FxCompiledDispatchNode
  | FxCompiledTakeNode
  | FxCompiledYieldNode;

export declare class FxNodeCompiler {
  resolveValue<T>(value: FxRef<T>): Prop<T>;
  resolveAction(value: unknown): (v: any) => unknown;
  compileNode(node: FxNode): FxCompiledNode;
}

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
   * FxNodeをFxCompiledNodeに変換するコンパイラロジック
   * @param node コンパイル対象の FxNode
   * @param compiler FxNodeCompilerのインスタンス
   */
  compile(
    node: Extract<FxNode, { type: T }>,
    compiler: FxNodeCompiler
  ): Extract<FxCompiledNode, { type: T }>;

  /**
   * コンパイル済みノードを実行するハンドラ
   * @param context 実行コンテキスト
   */
  handle(
    context: FxExecutionContext & { node: Extract<FxCompiledNode, { type: T }> }
  ): Promise<any>;

}


/**
 * エフェクト実行エンジンが要求するコンテキストの機能。
 */
type AppContext = Record<string, any>;

type CancelToken = { cancel: () => void; cancelled: () => boolean };


type FxHandlerMap = {
  [K in FxCompiledNode["type"]]?: (
    ctx: FxExecutionContext & { node: Extract<FxCompiledNode, { type: K }> }
  ) => Promise<any>
};


// 実行全体の設定
interface ExecContext {
  cancelToken: CancelToken;
  middlewares?: FxMiddleware[];
  onNodeEnter?: (node: FxCompiledNode) => void;
  onNodeExit?: (node: FxCompiledNode, result?:any, error?: Error) => void;
  runtimeState$: DripperStream<FxResult>; // 結果報告用
  yieldChannel$: DripperStream<YieldRequest>; // 対話用
}

// ミドルウェアに渡される、各ステップの情報
interface FxExecutionContext {
  node: FxCompiledNode;
  execute: (n:FxNode)=>Promise<AppContext>
  context: ExecContext
  appContext: AppContext
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
  readonly generator: Generator<FxNode, void, any>;
  readonly execContext: ExecContext;
  readonly appContext: AppContext; // プロキシされたコンテキスト
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
  results(): AsyncGenerator<YieldRequest, void, any>;

  /**
   * 実行の完了を知らせるPromise
   */
  done: Promise<AppContext>
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

export {
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
    FxDripNode,
    FxDispatchNode,
    FxTakeNode,
    FxYieldNode,
    FxCompiledNodeBase,
    FxCompiledNode,
    FxCompiledNoneNode,
    FxCompiledSequenceNode,
    FxCompiledParallelNode,
    FxCompiledRaceNode,
    FxCompiledWaitNode,
    FxCompiledLoopNode,
    FxCompiledConditionNode,
    FxCompiledSwitchNode,
    FxCompiledCallNode,
    FxCompiledDripNode,
    FxCompiledDispatchNode,
    FxCompiledTakeNode,
    FxCompiledYieldNode,

    FxRef,
    INodeDefinition,
    FxDispatchSettings,
    FxHandlerMap,FxMiddleware,
    PreparedFx,ExecutionHandle,
    FxResult,YieldRequest,
    AppContext,CancelToken,ExecContext,FxExecutionContext,
};