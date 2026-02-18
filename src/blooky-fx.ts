import {
  type FxNote,
  type AppContext,
  type ExecContext,
  type PreparedFx,
  type ExecutionHandle,
  type FxRef,
  type FxRefKey,
  type FxCallNote,
  type FxWaitNote,
  type FxYieldNote,
  type FxContextNote,
  type FxLoopNote,
} from "./blooky-fx-types";
import { prepare as prepareImpl, execute as executeImpl, FxRefSymbol } from "./runtime/runner";
import { createRegistry } from "./runtime/registry";
import { registerDefault } from "./runtime/register-default";
import { createDefaultProfile } from "./runtime/profile";
import { createBrowserLocalProfile } from "./runtime/profile-dom-local";

// registry は1回だけ作る
const registry = createRegistry();
registerDefault(registry);

export const prepare = (
  flow: FxNote,
  initialAppContext: AppContext = {},
  parent?: Partial<ExecContext>
): PreparedFx => {
  return prepareImpl(flow, initialAppContext, parent);
};

export const execute = (prepared: PreparedFx): ExecutionHandle => {
  const profile =
    typeof document !== "undefined"
      ? createBrowserLocalProfile({ resolve: prepared.execContext.resolve })
      : createDefaultProfile({ resolve: prepared.execContext.resolve });
  return executeImpl({ prepared, registry, profile });
};

export const query = (node: FxNote, app: AppContext = {}, ctx?: Partial<ExecContext>) =>
  execute(prepare(node, app, ctx));

export const ref = <T = unknown>(key: string): FxRefKey =>
  ({ [FxRefSymbol]: true, key } as unknown as FxRefKey);

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
    action: FxRef<(v: any) => unknown>,
    opt: Pick<FxCallNote, "arg" | "context" | "done" | "catcher" | "id"> = {}
  ): FxCallNote => ({
    type: "call",
    action,
    ...opt,
  }),
  yield: (note: Omit<FxYieldNote, "type">): FxYieldNote => ({ type: "yield", ...note }),
  context: (context: AppContext, child: FxNote, id?: string): FxContextNote => ({
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

export const RETURN_VALUE = Symbol("RETURN_VALUE");
