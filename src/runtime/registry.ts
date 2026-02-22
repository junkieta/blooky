import type { FxNote, ExecutionStep } from "../blooky-fx-types";
import type { RunnerProfile } from "./profile";
import type { CancelToken } from "../blooky-fx-types";
import { Cancelled } from "./engine";

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
export type RunChild = (
  n: FxNote,
  overrideAppContext?: Record<string | symbol, any>,
  overrideCancelToken?: CancelToken
) => Promise<unknown>;
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


const semNone: Semantics = function* () {};

const semReturn: Semantics = function* (note) {
  if (note.type !== "return") return;
  // refは解釈しない：dispatcher側で resolveMaybe
  yield { type: "terminate", value: note.value };
};

const semWait: Semantics = function* (note) {
  if (note.type !== "wait") return;
  yield { type: "effect", ref: { kind: "wait", ms: note.ms, until: note.until } };
};


const semYield: Semantics = function* (note) {
  if (note.type !== "yield") return;

  const until: YieldConditionRefV1 = {
    kind: "yield-v1",
    target: { kind: "local", ref: note.score }, // local/remote の切替は将来 note 側語彙で拡張
    input: note.input,
    meta: { noteType: "yield" },
  };

  yield { type: "suspend", until };
  // dispatcher が result を合成するので、ここで result を出す必要はない（出すなら二重になる）
};

const semCall: Semantics = function* (note) {
  if (note.type !== "call") return;
  // effect-only：applyEffectがresultを返しうる（runnerがFSMへresult合成）
  yield { type: "effect", ref: { kind: "call", action: note.action, arg: note.arg, context: note.context, done: note.done } };
};

const runSequence: StructureRunner = async (note, _ctx, deps) => {
  if (note.type !== "sequence") return undefined;
  let last: unknown = undefined;
  for (const child of note.steps) {
    last = await deps.runChild(child);
  }
  return last;
};

const runParallel: StructureRunner = async (note, _ctx, deps) => {
  if (note.type !== "parallel") return undefined;
  return Promise.all(note.steps.map((n) => deps.runChild(n)));
};

const runRace: StructureRunner = async (note, _ctx, deps) => {
  if (note.type !== "race") return undefined;

  const childTokens = note.steps.map(() => createChildCancelToken(deps.cancelToken));
  let settled = false;

  const wrapped = note.steps.map((child, i) =>
    deps
      .runChild(child, undefined, childTokens[i])
      .then((v) => {
        if (!settled) {
          settled = true;
          childTokens.forEach((t, j) => {
            if (j !== i) t.cancel("race_loser");
          });
        }
        return v;
      })
      .catch((e) => {
        if (!settled) {
          settled = true;
          childTokens.forEach((t, j) => {
            if (j !== i) t.cancel("race_loser");
          });
        }
        throw e;
      })
  );

  return Promise.race(wrapped);
};

const runLoop: StructureRunner = async (note, ctx, deps) => {
  if (note.type !== "loop") return undefined;
  let i = 0;
  let last: unknown = undefined;

  while (deps.profile.resolveRef(note.cond as any, ctx)) {
    if (deps.cancelToken.cancelled()) {
      throw new Cancelled(deps.cancelToken.reason ?? "user");
    }
    if (note.maxIterations !== undefined && i >= note.maxIterations) break;
    i += 1;
    last = await deps.runChild(note.body);
  }
  return last;
};

const runCondition: StructureRunner = async (note, ctx, deps) => {
  if (note.type !== "condition") return undefined;
  const selected = deps.profile.resolveSelection(note, ctx);
  return selected ? deps.runChild(selected) : undefined;
};

const runSwitch: StructureRunner = async (note, ctx, deps) => {
  if (note.type !== "switch") return undefined;
  const selected = deps.profile.resolveSelection(note, ctx);
  return selected ? deps.runChild(selected) : undefined;
};

const overlayContext = (
  parent: Record<string | symbol, any>,
  patch: Record<string | symbol, any>
) => {
  const scoped = Object.create(parent);
  for (const k of Reflect.ownKeys(patch)) {
    Object.defineProperty(scoped, k, {
      value: (patch as any)[k as any],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return scoped as Record<string | symbol, any>;
};

const runContext: StructureRunner = async (note, ctx, deps) => {
  if (note.type !== "context") return undefined;
  const scoped = overlayContext(ctx.appContext, note.context);
  return deps.runChild(note.child, scoped);
};

function createChildCancelToken(parent?: CancelToken): CancelToken {
  let cancelled = false;
  let reason: any;
  return {
    parent,
    cancel: (r: any = "user") => {
      cancelled = true;
      reason = r;
    },
    cancelled: () => cancelled || !!parent?.cancelled(),
    get reason() {
      if (cancelled) return reason;
      return parent?.reason;
    },
  };
}

export const registerDefault = (reg: Registry) => {
  reg.semantics.set("none", semNone);
  reg.semantics.set("return", semReturn);
  reg.semantics.set("wait", semWait);
  reg.semantics.set("yield", semYield);
  reg.semantics.set("call", semCall);

  reg.structures.set("sequence", runSequence);
  reg.structures.set("parallel", runParallel);
  reg.structures.set("race", runRace);
  reg.structures.set("loop", runLoop);
  reg.structures.set("condition", runCondition);
  reg.structures.set("switch", runSwitch);
  reg.structures.set("context", runContext);
};
