import type { FxNote, AppContext, ExecContext, PreparedFx, ExecutionHandle } from "./fx/types";
import { prepare as prepareImpl, execute as executeImpl } from "./runtime/runner";
import { createRegistry } from "./runtime/registry";
import { registerDefault } from "./runtime/register-default";
import { createDefaultProfile } from "./runtime/profile";

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
  const runSubflow = async (
    flow: FxNote,
    appContext: Record<string | symbol, any>,
    parent: Partial<ExecContext>
  ): Promise<Record<string | symbol, any>> => {
    const childPrepared = prepareImpl(flow, appContext, parent);
    const childProfile = createDefaultProfile({
      resolve: childPrepared.execContext.resolve,
      runSubflow,
    });
    const childHandle = executeImpl({ prepared: childPrepared, registry, profile: childProfile });
    return childHandle.done as Promise<Record<string | symbol, any>>;
  };

  const profile = createDefaultProfile({
    resolve: prepared.execContext.resolve,
    runSubflow,
  });
  return executeImpl({ prepared, registry, profile });
};

export const query = (node: FxNote, app: AppContext = {}, ctx?: Partial<ExecContext>) =>
  execute(prepare(node, app, ctx));

export const RETURN_VALUE = Symbol("RETURN_VALUE")