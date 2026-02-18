// src/fx/types.d.ts

import { Prop, DripperStream } from "./blooky-fp-types";

// ─── 実行ステップの定義 ───
/**
 * ExecutionStep: ノード実行の各段階を表現
 */
export type ExecutionStep = {
  phase: string;           // 'init' | 'running' | 'waiting' | 'completed' など
  note: FxNote;           // 現在のノード
  data?: any;             // フェーズ固有のデータ
};

// ─── FxRef: 実行時解決される値への参照 ───
export declare const FxRefSymbol: unique symbol;

export type FxRefKey = {
  readonly [FxRefSymbol]: true;
  readonly key: string;
};

export type FxRef<T> = FxRefKey | Prop<T> | T;


// ─── AppContext: アプリケーションコンテキスト ───
export type AppContext = Record<string | symbol, any>;


export type CancelReason = 
  | 'user'      // ユーザーによる手動キャンセル
  | 'return'    // fx-return による正常終了
  | 'timeout'   // タイムアウト
  | 'error'    // エラーによる中断
  | 'race_loser'; // race の敗者キャンセル

// ─── CancelToken ───

export type CancelToken = {
  parent?: CancelToken;
  cancel: (reason?: CancelReason) => void;
  cancelled: () => boolean;
  reason?: CancelReason; // 🆕 キャンセルの理由
};

// ─── ExecutionContext: ノード実行時のコンテキスト ───
export interface ExecutionContext {
  Note: FxNote;
  appContext: AppContext;
  executionId: string;
  
  // ユーティリティ
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  
  // 子ノードの実行
  executeChild: (child: FxNote) => AsyncGenerator<ExecutionStep, any, any>;
  
  cancelToken: CancelToken;
  
  onStep?: (step: ExecutionStep) => void | Promise<void>;
}

// ─── NoteDefinition Interface ───
export interface INoteDefinition<T extends FxNote['type']> {
  readonly type: T;
  
  /**
   * ノードを実行し、各段階を yield する
   */
  execute(
    ctx: ExecutionContext & { Note: Extract<FxNote, { type: T }> }
  ): AsyncGenerator<ExecutionStep, any, any>;
  
  /**
   * ノードが持つ子ノードを返す（グラフ可視化用）
   */
  getSubNotes?(Note: Extract<FxNote, { type: T }>): FxNote[] | null;
  
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

export type FxNoneNote = FxNoteBase<"none">;
export type FxSequenceNote = FxNoteBase<"sequence", { steps: FxNote[] }>;
export type FxParallelNote = FxNoteBase<"parallel", { steps: FxNote[] }>;
export type FxRaceNote = FxNoteBase<"race", { steps: FxNote[] }>;
export type FxWaitNote = FxNoteBase<"wait", { 
  ms?: FxRef<number>; 
  until?: FxRef<Prop<boolean>>; 
}>;
export type FxLoopNote = FxNoteBase<"loop", { 
  cond: FxRef<boolean>; 
  body: FxNote; 
  maxIterations?: number; 
  maxDuration?: number; 
}>;
export type FxConditionNote = FxNoteBase<"condition", { 
  if: FxRef<boolean>; 
  then: FxNote; 
  else?: FxNote; 
}>;
export type FxSwitchNote = FxNoteBase<"switch", { 
  by: FxRef<string | number | symbol>; 
  cases: Map<string | number | symbol, FxNote>; 
  default?: FxNote; 
}>;
export type FxCallNote = FxNoteBase<"call", { 
  action: FxRef<(v: any) => unknown>; 
  arg?: FxRef<any>; 
  context?: FxRef<any>; 
  done?: FxRef<DripperStream<any>>;
}>;
export type FxYieldNote = FxNoteBase<"yield", { 
  for: FxRef<FxContextNote>; 
  value?: FxRef<any>;
  done?: FxRef<DripperStream<any>>;
}>;
export type FxContextNote = FxNoteBase<"context", { 
  context: AppContext; 
  child: FxNote; 
}>;
export type FxReturnNote = FxNoteBase<"return", { 
  value: FxRef<any>; 
}>;

export type FxNote =
  | FxNoneNote
  | FxSequenceNote
  | FxParallelNote
  | FxRaceNote
  | FxWaitNote
  | FxLoopNote
  | FxConditionNote
  | FxSwitchNote
  | FxCallNote
  | FxYieldNote
  | FxContextNote
  | FxReturnNote;

export type FxNoteType = FxNote["type"];

// ─── ExecContext: prepare で生成される実行設定 ───
export interface ExecContext {
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  cancelToken: CancelToken;
  executionId?: string;
  onStep?: (step: ExecutionStep) => void | Promise<void>;
}

// ─── PreparedFx ───
export interface PreparedFx {
  readonly rootNote: FxNote;
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
