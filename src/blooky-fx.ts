import {
  type FxNote,
  type AppContext,
  type FxRuntime,
  type PreparedFx,
  type ExecutionHandle,
  type FxRef,
  type FxRefKey,
  type FxCallNote,
  type FxWaitNote,
  type FxYieldNote,
  type FxFlowNote,
  type FxLoopNote,
  FxCallAction,
} from "./blooky-fx-types";
import { prepare as prepareImpl, execute as executeImpl, FxRefSymbol } from "./runtime/engine";
import { createRegistry, registerDefault } from "./runtime/registry";
import { createDefaultProfile } from "./runtime/profile";
import { DripPlan } from "./blooky-fp-types";
import { clock } from "./runtime/clock";
import { TemplateYieldDriver, CompositeYieldDriver, LocalYieldHub } from "./runtime/yield";

// registry は1回だけ作る
const registry = createRegistry();
registerDefault(registry);

export const prepare = (
  flow: FxNote,
  initialAppContext: AppContext = {},
  parent?: Partial<FxRuntime>
): PreparedFx => {
  return prepareImpl(flow, initialAppContext, parent);
};

export const execute = (prepared: PreparedFx): ExecutionHandle => {
  const commit = (plan: DripPlan<any>) => clock.submitPlan(plan);
  const hub = new LocalYieldHub();
  const drivers: any = {};
  // template driver は DOM が必要（ただし profile は分岐不要。driver を差し替えるだけ）
  const isBrowser = typeof document !== "undefined";
  if (isBrowser) {
    drivers["template"] = new TemplateYieldDriver({
      hub,
      attachParent: document.body,
      getTemplateById: (id) => document.getElementById(id) as any,
    });
    drivers["template-el"] = drivers["template"];
  }
  // remote driver は transport があるなら常に注入可能
  // drivers["remote"] = new RemoteYieldDriver({ hub, client: remoteClient });
  const profile = createDefaultProfile({
    commit,
    observeCommit: clock.observeCommit,
    yieldHub: hub,
    yieldDriver: new CompositeYieldDriver(drivers),
  });
  return executeImpl({
    prepared, registry, profile
  });
};

export const query = (note: FxNote, app: AppContext = {}, ctx?: Partial<FxRuntime>) =>
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
  context: (context: AppContext, child: FxNote, id?: string): FxFlowNote => ({
    type: "context",
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

