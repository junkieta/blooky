// src/fx/types.d.ts

import { Prop, DripperStream } from "../blooky-types";

// ─── 実行ステップの定義 ───
/**
 * ExecutionStep: ノード実行の各段階を表現
 */
export type ExecutionStep = {
  phase: string;           // 'init' | 'running' | 'waiting' | 'completed' など
  node: FxNote;           // 現在のノード
  data?: any;             // フェーズ固有のデータ
};

// ─── FxRef: 実行時解決される値への参照 ───
export declare const FxRefSymbol: unique symbol;

export type FxRefKey<T> = {
  readonly [FxRefSymbol]: true;
  readonly key: string;
};

export type FxRef<T> = FxRefKey<T> | Prop<T> | T;


// ─── AppContext: アプリケーションコンテキスト ───
export type AppContext = Record<string | symbol, any>;


export type CancelReason = 
  | 'user'      // ユーザーによる手動キャンセル
  | 'return'    // fx-return による正常終了
  | 'timeout'   // タイムアウト
  | 'error';    // エラーによる中断

// ─── CancelToken ───

export type CancelToken = {
  parent?: CancelToken;
  cancel: (reason?: CancelReason) => void;
  cancelled: () => boolean;
  reason?: CancelReason; // 🆕 キャンセルの理由
};

// ─── ExecutionContext: ノード実行時のコンテキスト ───
export interface ExecutionContext {
  node: FxNote;
  appContext: AppContext;
  executionId: string;
  
  // ユーティリティ
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  
  // 子ノードの実行
  executeChild: (child: FxNote) => AsyncGenerator<ExecutionStep, any, any>;
  
  // デバッグ・制御
  debugController?: any; // DebugController（循環参照回避のため any）
  cancelToken: CancelToken;
  
  // ミドルウェア・フック
  middlewares?: FxMiddleware[];
  onStep?: (step: ExecutionStep) => void;
}

// ─── Middleware ───
export type FxMiddleware = (
  ctx: { step: ExecutionStep; node: FxNote; executionId: string },
  next: () => Promise<void>
) => Promise<void>;

// ─── NodeDefinition Interface ───
export interface INodeDefinition<T extends FxNote['type']> {
  readonly type: T;
  
  /**
   * ノードを実行し、各段階を yield する
   */
  execute(
    ctx: ExecutionContext & { node: Extract<FxNote, { type: T }> }
  ): AsyncGenerator<ExecutionStep, any, any>;
  
  /**
   * ノードが持つ子ノードを返す（グラフ可視化用）
   */
  getSubNotes?(node: Extract<FxNote, { type: T }>): FxNote[] | null;
  
  /**
   * ファクトリ関数（fx.call(...) のような API）
   */
  factory(...args: any[]): Extract<FxNote, { type: T }>;
}

// ─── FxNote 定義 ───
type FxNoteBase<T extends string, P = {}> = P & {
  type: T;
  id?: string;
  catcher?: FxRef<(error: Error) => unknown>;
};

export type FxNoneNode = FxNoteBase<"none">;
export type FxSequenceNode = FxNoteBase<"sequence", { steps: FxNote[] }>;
export type FxParallelNode = FxNoteBase<"parallel", { steps: FxNote[] }>;
export type FxRaceNode = FxNoteBase<"race", { steps: FxNote[] }>;
export type FxWaitNode = FxNoteBase<"wait", { 
  ms?: FxRef<number>; 
  until?: FxRef<Prop<boolean>>; 
}>;
export type FxLoopNode = FxNoteBase<"loop", { 
  cond: FxRef<boolean>; 
  body: FxNote; 
  maxIterations?: number; 
  maxDuration?: number; 
}>;
export type FxConditionNode = FxNoteBase<"condition", { 
  if: FxRef<boolean>; 
  then: FxNote; 
  else?: FxNote; 
}>;
export type FxSwitchNode = FxNoteBase<"switch", { 
  by: FxRef<string | number | symbol>; 
  cases: Map<string | number | symbol, FxNote>; 
  default?: FxNote; 
}>;
export type FxCallNode = FxNoteBase<"call", { 
  action: FxRef<(v: any) => unknown>; 
  arg?: FxRef<any>; 
  context?: FxRef<any>; 
}>;
export type FxCollapseNode = FxNoteBase<"collapse", { 
  dripper: FxRef<DripperStream<any>>; 
  value: FxRef<any>; 
  promise?: FxRef<"deny" | "allow" | "await">; 
}>;
export type FxYieldNode = FxNoteBase<"yield", { 
  for: FxRef<FxContextNode>; 
  value: FxRef<any>; 
}>;
export type FxContextNode = FxNoteBase<"context", { 
  context: AppContext; 
  child: FxNote; 
}>;
export type FxReturnNode = FxNoteBase<"return", { 
  value: FxRef<any>; 
}>;

export type FxNote =
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

export type FxNoteType = FxNote["type"];

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
  readonly rootNode: FxNote;
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
  [K in FxNoteType]: (...args: any[]) => Extract<FxNote, { type: K }>;
};