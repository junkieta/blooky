import { bind } from "../blooky-context";
import type { FxNote, Registry, Semantics, StructureEvent, StructureRunner, YieldConditionRef } from "../blooky-fx-types";
import type { CancelToken } from "../blooky-fx-types";
import { Cancelled } from "./engine";


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

  const {timer,until} = note;
  // note.timer があるなら timer にする
  if (timer !== undefined) {
    yield { type: "suspend", until: { kind: "timer", timer } };
    return;
  }
  // note.until が FxRef<boolean> なら ref にする
  if (until !== undefined) {
    yield { type: "suspend", until: { kind: "ref", ref: until } };
    return;
  }

  // invalid wait note should be rejected before semantics (e.g. during prepare/factory validation)
};

const semYield: Semantics = function* (note) {
  if (note.type !== "yield") return;

  const until: YieldConditionRef = {
    kind: "yield",
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
  yield { type: "effect", ref: { kind: "call", action: note.action, input: note.input, done: note.done } };
};

const runSequence: StructureRunner = async function* (note, _ctx) {
  if (note.type !== "sequence") return undefined;
  let last: unknown = undefined;
  for (const child of note.steps) {
    last = yield { type: "run", note: child };
  }
  return last;
};

const runParallel: StructureRunner = async function* (note, _ctx) {
  if (note.type !== "parallel") return undefined;
  return yield { type: "run-all", notes: note.steps };
};

const runRace: StructureRunner = async function* (note, ctx) {
  if (note.type !== "race") return undefined;
  const childTokens = note.steps.map(() => createChildCancelToken(ctx.cancelToken));
  return yield { type: "run-race", notes: note.steps, childTokens };
};

const runLoop: StructureRunner = async function* (note, ctx) {
  if (note.type !== "loop") return undefined;
  const cond = ctx.config.resolver(note.cond as any, ctx);
  let i = 0;
  let last: unknown = undefined;
  while (cond()) {
    if (ctx.cancelToken.cancelled()) throw new Cancelled(ctx.cancelToken.reason ?? "user");
    if (note.maxIterations !== undefined && i >= note.maxIterations) break;
    if (i > 0) yield { type: "iterate", iteration: i };
    i++;
    last = yield { type: "run", note: note.body };
  }
  return last;
};

const runCondition: StructureRunner = async function* (note, _ctx) {
  if (note.type !== "condition") return undefined;
  const selected = yield { type: "resolve-selection", note } as StructureEvent;
  if (!selected) return undefined;
  return yield { type: "run", note: selected as FxNote };
};

const runSwitch: StructureRunner = async function* (note, _ctx) {
  if (note.type !== "switch") return undefined;
  const selected = yield { type: "resolve-selection", note } as StructureEvent;
  if (!selected) return undefined;
  return yield { type: "run", note: selected as FxNote };
};

const runFlow: StructureRunner = async function* (note, ctx) {
  if (note.type !== "flow") return undefined;
  const scoped = overlayContext(ctx.appContext, note.context);
  return yield { type: "run", note: note.child, appContext: scoped };
};

const overlayContext = (
  parent: Record<string, any>,
  patch: Record<string, any>
) => {
  const scoped = Object.create(parent);
  for (const k of Reflect.ownKeys(patch) as string[]) {
    // ContextKey = string 方針をここで強制
    if (typeof k !== "string") {
      throw new Error(`[context] overlayContext: non-string key is not allowed: ${String(k)}`);
    }
    
    const v = (patch as any)[k];
    
    // 1) codec metadata
    bind(scoped, k, v);

    // 2) actual property (keep it immutable to avoid meta/value divergence)
    Object.defineProperty(scoped, k, {
      value: v,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return scoped as Record<string, any>;
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
  reg.structures.set("flow", runFlow);
};
