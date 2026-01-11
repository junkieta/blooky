// src/fx/types.d.ts

import { Prop, DripperStream } from "../blooky-types";
import { PromisedProp } from "../blooky-fp";

// ─── 実行ステップの定義 ───
/**
 * ExecutionStep: ノード実行の各段階を表現
 */
export type ExecutionStep = {
  phase: string;           // 'init' | 'running' | 'waiting' | 'completed' など
  node: FxNode;           // 現在のノード
  data?: any;             // フェーズ固有のデータ
  
  // devtools 向け情報（オプショナル）
  visual?: {
    label?: string;       // UI に表示するラベル
    description?: string; // 詳細説明
    color?: string;       // 色（CSS color値）
    icon?: string;        // アイコン
    progress?: number;    // 0-1 の進捗
  };
};

// ─── FxRef: 実行時解決される値への参照 ───
export type FxRef<T> = 
  | ({ [key in symbol]: true; } & { key: string; })
  | Prop<T> 
  | T;

// ─── AppContext: アプリケーションコンテキスト ───
export type AppContext = Record<string | symbol, any>;

// ─── CancelToken ───
export type CancelToken = {
  parent?: CancelToken;
  cancel: () => void;
  cancelled: () => boolean;
};

// ─── ExecutionContext: ノード実行時のコンテキスト ───
export interface ExecutionContext {
  node: FxNode;
  appContext: AppContext;
  executionId: string;
  
  // ユーティリティ
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  
  // 子ノードの実行
  executeChild: (child: FxNode) => AsyncGenerator<ExecutionStep, any, any>;
  
  // デバッグ・制御
  debugController?: any; // DebugController（循環参照回避のため any）
  cancelToken: CancelToken;
  
  // ミドルウェア・フック
  middlewares?: FxMiddleware[];
  onStep?: (step: ExecutionStep) => void;
}

// ─── Middleware ───
export type FxMiddleware = (
  ctx: { step: ExecutionStep; node: FxNode; executionId: string },
  next: () => Promise<void>
) => Promise<void>;

// ─── NodeDefinition Interface ───
export interface INodeDefinition<T extends FxNode['type']> {
  readonly type: T;
  
  /**
   * ノードを実行し、各段階を yield する
   */
  execute(
    ctx: ExecutionContext & { node: Extract<FxNode, { type: T }> }
  ): AsyncGenerator<ExecutionStep, any, any>;
  
  /**
   * ノードが持つ子ノードを返す（グラフ可視化用）
   */
  getChildNodes?(node: Extract<FxNode, { type: T }>): FxNode[] | null;
  
  /**
   * ファクトリ関数（fx.call(...) のような API）
   */
  factory(...args: any[]): Extract<FxNode, { type: T }>;
}

// ─── FxNode 定義 ───
type FxNodeBase<T extends string, P = {}> = P & {
  type: T;
  id?: string;
  catcher?: FxRef<(error: Error) => unknown>;
};

export type FxNoneNode = FxNodeBase<"none">;
export type FxSequenceNode = FxNodeBase<"sequence", { steps: FxNode[] }>;
export type FxParallelNode = FxNodeBase<"parallel", { steps: FxNode[] }>;
export type FxRaceNode = FxNodeBase<"race", { steps: FxNode[] }>;
export type FxWaitNode = FxNodeBase<"wait", { 
  ms?: FxRef<number>; 
  until?: FxRef<Prop<boolean> | PromisedProp<any>>; 
}>;
export type FxLoopNode = FxNodeBase<"loop", { 
  cond: FxRef<boolean>; 
  body: FxNode; 
  maxIterations?: number; 
  maxDuration?: number; 
}>;
export type FxConditionNode = FxNodeBase<"condition", { 
  if: FxRef<boolean>; 
  then: FxNode; 
  else?: FxNode; 
}>;
export type FxSwitchNode = FxNodeBase<"switch", { 
  by: FxRef<string | number | symbol>; 
  cases: Map<string | number | symbol, FxNode>; 
  default?: FxNode; 
}>;
export type FxCallNode = FxNodeBase<"call", { 
  action: FxRef<(v: any) => unknown>; 
  arg?: FxRef<any>; 
  context?: FxRef<any>; 
}>;
export type FxCollapseNode = FxNodeBase<"collapse", { 
  dripper: FxRef<DripperStream<any>>; 
  value: FxRef<any>; 
  promise?: FxRef<"deny" | "allow" | "await">; 
}>;
export type FxYieldNode = FxNodeBase<"yield", { 
  for: FxRef<FxContextNode>; 
  value: FxRef<any>; 
}>;
export type FxContextNode = FxNodeBase<"context", { 
  context: AppContext; 
  child: FxNode; 
}>;
export type FxReturnNode = FxNodeBase<"return", { 
  value: FxRef<any>; 
}>;

export type FxNode =
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
  | FxYieldNode
  | FxContextNode
  | FxReturnNode;

export type FxNodeType = FxNode["type"];

// ─── ExecContext: prepare で生成される実行設定 ───
export interface ExecContext {
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  cancelToken: CancelToken;
  middlewares?: FxMiddleware[];
  debugController?: any;
  executionId?: string;
  onStep?: (step: ExecutionStep) => void;
}

// ─── PreparedFx ───
export interface PreparedFx {
  readonly rootNode: FxNode;
  readonly execContext: ExecContext;
  readonly appContext: AppContext;
}

// ─── ExecutionHandle ───
export interface ExecutionHandle {
  cancel: () => void;
  done: Promise<AppContext>;
}

// ─── FxFactoryMap ───
export type FxFactoryMap = {
  [K in FxNodeType]: (...args: any[]) => Extract<FxNode, { type: K }>;
};