import type { FxNote, CancelToken, ExecutionStep } from "../blooky-fx-types";
import type { RunnerProfile } from "./profile";

export type ConditionRef = unknown;

export type SemanticEvent =
  | { type: "result"; value: unknown }
  | { type: "suspend"; until: ConditionRef }
  | { type: "effect"; ref: unknown }
  | { type: "terminate"; value?: unknown };

// ─────────────────────────────────────────────
// Yield v1 (remote 対応) 固定型
// runtime は DOM 型を知らない（targetRef は opaque）
// ─────────────────────────────────────────────

export type YieldTargetRefV1 =
  | { kind: "local"; ref: unknown }   // 例: template-id / component-handle / anything
  | { kind: "remote"; ref: unknown }; // 例: ws://... / remote execution handle / anything

export type YieldConditionRefV1 = {
  kind: "yield-v1";
  target: YieldTargetRefV1;
  input?: unknown;        // 外部入力（value）。構造は profile が解釈
  meta?: Record<string, unknown>; // 診断用（任意）
};

export type PerfCtx = {
  note: FxNote;
  appContext: Record<string | symbol, any>;
  executionId: string;
};

export type Semantics = (note: FxNote, ctx: PerfCtx) => Generator<SemanticEvent, void, void>;
export type RunChild = (n: FxNote, overrideAppContext?: Record<string | symbol, any>) => Promise<unknown>;
export type StepSink = (step: ExecutionStep) => void;

export type StructureDeps = {
  runChild: RunChild;
  profile: RunnerProfile;
  cancelToken: CancelToken;
  emit: StepSink;
};

export type StructureRunner = (note: FxNote, ctx: PerfCtx, deps: StructureDeps) => Promise<unknown>;

export interface Registry {
  semantics: Map<FxNote["type"], Semantics>;
  structures: Map<FxNote["type"], StructureRunner>;
}

export const createRegistry = (): Registry => ({
  semantics: new Map(),
  structures: new Map(),
});
