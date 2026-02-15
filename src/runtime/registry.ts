import type { FxNote, CancelToken, ExecutionStep } from "../fx/types";
import type { RunnerProfile } from "./profile";

export type ConditionRef = unknown;

export type SemanticEvent =
  | { type: "result"; value: unknown }
  | { type: "suspend"; until: ConditionRef }
  | { type: "effect"; ref: unknown }
  | { type: "terminate"; value?: unknown };

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
