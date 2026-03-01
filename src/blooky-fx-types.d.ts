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
export type AppContext = Record<string, any>;


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
  action: FxRef<FxCallAction>; 
  input?: FxRef<any>; 
  done?: FxRef<DripperStream<any>>;
}>;
export type FxYieldNote = FxNoteBase<"yield", { 
  score: FxRef<unknown>; 
  input?: FxRef<any>;
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

// ─── FxRuntime: prepare で生成される実行設定 ───
export interface FxRuntime {
  resolver: <T>(ref: FxRef<T>, ctx: PerfCtx) => Prop<T>;
  cancelToken: CancelToken;
  executionId?: string;
  idSlots: Record<string, any>
}

// ─── PreparedFx ───
export interface PreparedFx {
  readonly rootNote: FxNote;
  readonly runtime: FxRuntime;
  readonly appContext: AppContext;
}

export type StepObserver = (step: ExecutionStep) => void | Promise<void>

// ─── ExecutionHandle ───
export interface ExecutionHandle {
  cancel: () => void;
  observeStep: (fn: StepObserver) => () => void
  done: Promise<unknown>;
}

// ─── FxFactoryMap ───
export type FxFactoryMap = {
  [K in FxNoteType]: (...args: any[]) => Extract<FxNote, { type: K }>;
};


export type YieldSession = {
  kind: "yield-session";
  id: string;
  until: YieldConditionRef;
};

export type EffectOutcome =
  | { kind: "none" }
  | { kind: "result"; value: unknown };

type SuspendOutcome =
  | { kind: "continue" }
  | { kind: "result"; value: unknown };

export interface RunnerProfile {

  resolveSelection(
    note: Extract<FxNote, { type: "condition" | "switch" }>,
    ctx: PerfCtx
  ): FxNote | null;

  // Yield or Wait
  awaitSuspend(until: SuspendUntil, ctx: PerfCtx, cancel: CancelToken): Promise<SuspendOutcome>;

  // Yield lifecycle
  startYield(until: YieldConditionRef, ctx: PerfCtx): Promise<YieldSession>;
  awaitYield(session: YieldSession, ctx: PerfCtx, cancelToken: CancelToken): Promise<void>;
  getYieldResult(session: YieldSession, ctx: PerfCtx): Promise<unknown>;

  projectEffect(ref: unknown, ctx: PerfCtx): unknown;
  applyEffect(ref: unknown, ctx: PerfCtx): Promise<EffectOutcome>;

  /**
   * note の exit 境界で呼ばれる（note と note の間）
   * - done が DripperStream を参照している場合だけ FRP に接続する
   * - 呼び出し側（runner）は await する（タイムライン同期のため）
   */
  applyExitBoundary(note: FxNote, ctx: PerfCtx, result: unknown, meta?: { terminated?: boolean }): Promise<void>;

}


export type ConditionRef = unknown;

export type SemanticEvent =
  | { type: "result"; value: unknown }
  | { type: "suspend"; until: SuspendUntil }
//  | { type: "suspend"; until: ConditionRef }
  | { type: "effect"; ref: unknown }
  | { type: "terminate"; value?: unknown };

export type YieldUntil = YieldConditionRef;

// fx-wait 用（必要最小限の例）
export type WaitUntil =
  | { kind: "timer"; ms: FxRef<number> }              // ms 待つ
  | { kind: "ref"; ref: FxRef<Prop<boolean>> };       // resolveRef で boolean を得て監視（Profileが意味づけ）

export type SuspendUntil = YieldUntil | WaitUntil;

// ─────────────────────────────────────────────
// Yield (remote 対応) 固定型
// runtime は DOM 型を知らない（targetRef は opaque）
// ─────────────────────────────────────────────

export type YieldTargetRef =
  | { kind: "local"; ref: unknown }   // 例: template-id / component-handle / anything
  | { kind: "remote"; ref: unknown }; // 例: ws://... / remote execution handle / anything

export type YieldConditionRef = {
  kind: "yield";
  target: YieldTargetRef;
  input?: unknown;        // 外部入力（value）。構造は profile が解釈
  meta?: Record<string, unknown>; // 診断用（任意）
};

export type PerfCtx = {
  note: FxNote;
  appContext: AppContext;
  runtime: FxRuntime;
  executionId: string;
};

export type Semantics = (note: FxNote, ctx: PerfCtx) => Generator<SemanticEvent, void, void>;
export type RunChild = (
  n: FxNote,
  overrideAppContext?: AppContext,
  overrideCancelToken?: CancelToken
) => Promise<unknown>;
export type StepSink = (step: ExecutionStep) => void;

export type StructureDeps = {
  runChild: RunChild;
  profile: RunnerProfile;
  cancelToken: CancelToken;
};

export type StructureRunner = (note: FxNote, ctx: PerfCtx, deps: StructureDeps) => Promise<unknown>;

export interface Registry {
  semantics: Map<FxNote["type"], Semantics>;
  structures: Map<FxNote["type"], StructureRunner>;
}

/** locator: yield の主権移譲先 */
export type YieldLocator =
  | { kind: "template"; templateId: string }                 // HTMLTemplateElement を id で
  | { kind: "template-el"; el: HTMLTemplateElement }         // 直接参照
  | { kind: "remote"; endpoint: string; locator: unknown }   // remote へ委譲（details は adapter 依存）
  | { kind: "worker"; workerId: string; locator: unknown };  // worker へ委譲

export type YieldRequest = {
  id: string;
  locator: YieldLocator;
  input?: unknown;
  ctx: PerfCtx;
  /** 任意：cancel を driver 側でも参照したい場合 */
  cancelToken?: CancelToken;
};

export interface YieldHub {
  start(id: string): void;
  await(id: string): Promise<void>;
  resolve(id: string, value: unknown): void;
  reject(id: string, error: unknown): void;
  get(id: string): unknown;
}

export interface YieldDriver {
  requestYield(req: YieldRequest): void | Promise<void>;
}

interface FxCallAction<A = void, B = unknown> {
  call(context: Readonly<AppContext>, input: A): B | Promise<B>
}