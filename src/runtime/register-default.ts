import type { Registry, Semantics, StructureRunner, YieldConditionRefV1 } from "./registry";
import type { CancelToken } from "../blooky-fx-types";
import { Cancelled } from "./dispatcher";

const semNone: Semantics = function* () {};

const semReturn: Semantics = function* (note) {
  if (note.type !== "return") return;
  // refは解釈しない：dispatcher側で resolveMaybe
  yield { type: "terminate", value: note.value };
};

const semWait: Semantics = function* (note) {
  if (note.type !== "wait") return;
  yield { type: "suspend", until: { kind: "wait", ms: note.ms, until: note.until } };
  yield { type: "result", value: undefined };
};


const semYield: Semantics = function* (note) {
  if (note.type !== "yield") return;

  const until: YieldConditionRefV1 = {
    kind: "yield-v1",
    target: { kind: "local", ref: note.for }, // local/remote の切替は将来 note 側語彙で拡張
    input: note.value,
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
    (scoped as any)[k as any] = (patch as any)[k as any];
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
