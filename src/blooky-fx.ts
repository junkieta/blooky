import {
  type FxNote,
  type AppContext,
  type ExecutionConfig,
  type PreparedFx,
  type ExecutionHandle,
  type PerformanceStep,
  type FxRef,
  type FxRefKey,
  type FxCallNote,
  type FxWaitNote,
  type FxYieldNote,
  type FxFlowNote,
  type FxLoopNote,
  FxCallAction,
  BridgeEffect,
} from "./blooky-fx-types";
import { prepare, execute as executeImpl, FxRefSymbol } from "./runtime/engine";
import { createRegistry, registerDefault } from "./runtime/registry";
import { createDefaultProfile } from "./runtime/profile";
import { clock } from "./runtime/clock";
import { emitRuntimeStep, observeRuntimeStep } from "./runtime/step-line";
import { TemplateYieldDriver, CompositeYieldDriver } from "./runtime/yield";

// registry は1回だけ作る
const registry = createRegistry();
registerDefault(registry);

// prepareは変更なし
export {prepare};

export const execute = (prepared: PreparedFx): ExecutionHandle => {
  const drivers: any = {};
  // template driver は DOM が必要（ただし profile は分岐不要。driver を差し替えるだけ）
  const isBrowser = typeof document !== "undefined";
  if (isBrowser) {
    drivers["template"] = new TemplateYieldDriver({
      attachParent: document.body,
      getTemplateById: (id) => document.getElementById(id) as any,
    });
    drivers["template-el"] = drivers["template"];
  }
  // remote driver は transport があるなら常に注入可能
  // drivers["remote"] = new RemoteYieldDriver({ client: remoteClient });
  const profile = createDefaultProfile({
    runtime: {
      observeCommit: clock.observeCommit,
      unobserveCommit: clock.unobserveCommit,
      submitPlan: clock.submitPlan
    },
    yieldDriver: new CompositeYieldDriver(drivers),
  });
  const onStep = async (step: PerformanceStep) => {
    const effect = step.effect as BridgeEffect | undefined;
    if (effect?.kind === "done") {
      await clock.submitPlan([effect.dripper, effect.value]);
    }
    emitRuntimeStep(step);
  };
  const handle = executeImpl({
    prepared,
    registry,
    profile,
    onStep,
  });
  return {
    cancel: handle.cancel,
    done: handle.done,
  };
};

export { observeRuntimeStep };

export const query = (note: FxNote, app: AppContext = {}, ctx?: Partial<ExecutionConfig>) =>
  execute(prepare(note, app, ctx));

export const ref = <T = unknown>(key: string): FxRefKey =>
  ({ [FxRefSymbol]: true, key } as FxRefKey);

export const fx = {
  none: (id?: string): FxNote => ({ type: "none", ...(id ? { id } : {}) }),
  sequence: (steps: FxNote[], id?: string): FxNote => ({ type: "sequence", steps, ...(id ? { id } : {}) }),
  parallel: (steps: FxNote[], id?: string): FxNote => ({ type: "parallel", steps, ...(id ? { id } : {}) }),
  race: (steps: FxNote[], id?: string): FxNote => ({ type: "race", steps, ...(id ? { id } : {}) }),
  wait: (note: Omit<FxWaitNote, "type">): FxWaitNote => ({ type: "wait", ...note }),
  loop: (cond: FxRef<boolean>, body: FxNote, opt: Pick<FxLoopNote, "maxIterations" | "maxDuration"> = {}, id?: string): FxLoopNote => ({
    type: "loop",
    cond,
    body,
    ...opt,
    ...(id ? { id } : {}),
  }),
  condition: (ifRef: FxRef<boolean>, then: FxNote, elseNote?: FxNote, id?: string): FxNote => ({
    type: "condition",
    if: ifRef,
    then,
    ...(elseNote ? { else: elseNote } : {}),
    ...(id ? { id } : {}),
  }),
  switch: (
    by: FxRef<string | number | symbol>,
    cases: Map<string | number | symbol, FxNote>,
    defaultNote?: FxNote,
    id?: string
  ): FxNote => ({
    type: "switch",
    by,
    cases,
    ...(defaultNote ? { default: defaultNote } : {}),
    ...(id ? { id } : {}),
  }),
  call: (
    action: FxRef<FxCallAction>,
    opt: Pick<FxCallNote, "input" | "done" | "id"> = {}
  ): FxCallNote => ({
    type: "call",
    action,
    ...opt,
  }),
  yield: (note: Omit<FxYieldNote, "type">): FxYieldNote => ({ type: "yield", ...note }),
  flow: (context: AppContext, child: FxNote, id?: string): FxFlowNote => ({
    type: "flow",
    context,
    child,
    ...(id ? { id } : {}),
  }),
  return: (value?: FxRef<any>, id?: string): FxNote => ({
    type: "return",
    value: value === undefined ? undefined : value,
    ...(id ? { id } : {}),
  }),
};

