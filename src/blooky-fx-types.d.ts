// src/fx/types.d.ts

import { Prop, DripperStream } from "./blooky-fp-types";

export type PerformancePhase =
  | "enter"
  | "active"
  | "suspend"
  | "resume"
  | "exit"
  | "cancel";

export type PerformanceStep = {
  phase: PerformancePhase;
  note_id: string;
  execution_id: string;
  step_index: number;
  // Implementation convention:
  // semantic events such as effect/result/terminate are represented in payload.event
  // while phase remains one of PerformancePhase.
  payload?: unknown;
  effect?: unknown;
  timestamp?: number;
};

export type PerformanceStepDraft = Omit<PerformanceStep, "step_index"|"execution_id"|"note_id">;


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

// ─── FxNote 定義 ───
type FxNoteBase<T extends string, P = {}> = P & {
  type: T;
  id?: string;
};

export type FxNoneNote = FxNoteBase<"none">;
export type FxSequenceNote = FxNoteBase<"sequence", { steps: FxNote[] }>;
export type FxParallelNote = FxNoteBase<"parallel", { steps: FxNote[] }>;
export type FxRaceNote = FxNoteBase<"race", { steps: FxNote[] }>;
export type FxWaitNote = FxNoteBase<"wait", { 
  timer?: FxRef<number>;
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
export type FxFlowNote = FxNoteBase<"flow", { 
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
  | FxFlowNote
  | FxReturnNote;

export type FxNoteType = FxNote["type"];

// ─── prepare で生成される実行設定 ───
export interface ExecutionConfig {
  resolver: <T>(ref: FxRef<T>, ctx: ExecutionContext) => Prop<T>;
  idSlots: Record<string, any>;
  executionId?: string;
}

// ─── PreparedFx ───
export interface PreparedFx {
  readonly rootNote: FxNote;
  readonly config: ExecutionConfig;
  readonly appContext: AppContext;
}

export type StepObserver = (step: PerformanceStep) => void | Promise<void>

// ─── ExecutionHandle ───
export interface ExecutionHandle {
  cancel: () => void;
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


export type BridgeEffect = {
  kind: "done";
  dripper: DripperStream<any>;
  value: unknown;
};

export type OutcomeBase<T> = 
  | { kind: "value"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "crash"; error: unknown; source: "action" | "child_boundary" | "runner" | "host" }
  | { kind: "timeout" }
  | { kind: "cancel"; reason?: unknown }

export type EffectOutcome<T> =
  | { kind: "none" }
  | OutcomeBase<T>;

export type SuspendOutcome<T> =
  | { kind: "continue" }
  | Exclude<OutcomeBase<T>, { kind: "error" }>;

export interface RunnerProfile {
  resolveSelection(
    note: Extract<FxNote, { type: "condition" | "switch" }>,
    ctx: ExecutionContext
  ): FxNote | null;

  // Yield or Wait
  awaitSuspend(until: SuspendUntil, ctx: ExecutionContext): Promise<SuspendOutcome<unknown>>;

  projectEffect(ref: unknown, ctx: ExecutionContext): unknown;
  applyEffect(ref: unknown, ctx: ExecutionContext): Promise<EffectOutcome<unknown>>;

}

export type SemanticEvent =
  | { type: "result"; value: unknown }
  | { type: "suspend"; until: SuspendUntil }
  | { type: "effect"; ref: unknown }
  | { type: "terminate"; value?: unknown };

export type YieldUntil = YieldConditionRef;

// fx-wait 用（必要最小限の例）
export type WaitUntil =
  | { kind: "timer"; timer: FxRef<number> }              // ms 待つ
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

export type ExecutionContext = {
  note: FxNote;
  appContext: AppContext;
  executionId: string;
  cancelToken: CancelToken;
  config: ExecutionConfig;
};

export type Semantics = (note: FxNote, ctx: ExecutionContext) => Generator<SemanticEvent, void, void>;
export type RunChild = (
  n: FxNote,
  overrideAppContext?: AppContext,
  overrideCancelToken?: CancelToken
) => Promise<unknown>;
export type StepSink = (step: PerformanceStepDraft) => void | Promise<void>;

export type StructureEvent =
  | { type: "run";              note: FxNote; appContext?: AppContext; cancelToken?: CancelToken }
  | { type: "run-all";          notes: FxNote[] }
  | { type: "run-race";         notes: FxNote[]; childTokens: CancelToken[] }
  | { type: "resolve-selection"; note: Extract<FxNote, { type: "condition" | "switch" }> }
  | { type: "iterate", iteration: number };

// AsyncGenerator<yield型, return型, next型>
export type StructureRunner = (
  note: FxNote,
  ctx: ExecutionContext
) => AsyncGenerator<StructureEvent, unknown, unknown>;

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
  ctx: ExecutionContext;
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

export interface FxCallAction<A = void, B = unknown> {
  call(context: Readonly<AppContext>, input: A): B | Promise<B>
}

/**
 * FxRuntime — Execution → Clock の書き込み契約
 *
 * FVRuntime が「Clock → DOM」の観測側アダプターであるのに対し、
 * FxRuntime は「Execution → Clock」の書き込み側アダプターである。
 *
 * Runner が生成した PerformanceStep を受け取り、
 * step.effect を Clock transaction（submitPlan）へ変換する唯一の経路。
 *
 * - runtime semantics を変更してはならない（MUST NOT）
 * - step の順序・内容を書き換えてはならない（MUST NOT）
 * - submitPlan の失敗は Execution failure として上位に伝播してよい（MAY）
 */
export interface _FxRuntime {
  onStep(step: PerformanceStep): Promise<void>;
}

