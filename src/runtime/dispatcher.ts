import type { SemanticEvent, PerfCtx, StepSink } from "./registry";
import type { RunnerProfile } from "./profile";
import type { CancelToken } from "../fx/types";

export class Terminated extends Error {
  readonly name = "Terminated";
  constructor(readonly value: unknown) {
    super("Performance terminated");
  }
}

export class Cancelled extends Error {
  readonly name = "Cancelled";
  constructor(readonly reason: string) {
    super(`Execution cancelled: ${reason}`);
  }
}

/**
 * Semanticsはrefを解釈しない前提なので、result/terminate の value は "未解決" を許す。
 * ここで profile.resolveRef を試み、ダメなら素通し（保険）にする。
 */
const resolveMaybe = (profile: RunnerProfile, v: unknown, ctx: PerfCtx) => {
  try {
    return profile.resolveRef(v as any, ctx);
  } catch (e) {
    console.warn("[score-fx/dispatcher] Failed to resolve ref, passing through:", v, e);
    return v;
  }
};

export type DispatchDeps = {
  profile: RunnerProfile;
  ctx: PerfCtx;
  cancelToken: CancelToken;
  emit: StepSink;
};

export const dispatchEvent = async (ev: SemanticEvent, deps: DispatchDeps) => {
  if (deps.cancelToken.cancelled()) {
    throw new Cancelled(deps.cancelToken.reason ?? "user");
  }

  switch (ev.type) {
    case "effect": {
      const projected = deps.profile.projectEffect(ev.ref, deps.ctx);
      deps.emit({ phase: "effect", node: deps.ctx.note, data: projected });

      const applied = await deps.profile.applyEffect(ev.ref, deps.ctx);
      if (applied.kind === "result") {
        deps.emit({ phase: "result", node: deps.ctx.note, data: { value: applied.value } });
        return { kind: "result" as const, value: applied.value };
      }
      return { kind: "continue" as const };
    }

    case "suspend":
      deps.emit({ phase: "suspend", node: deps.ctx.note, data: { until: ev.until } });
      const suspendOutcome = await deps.profile.awaitSuspend(ev.until, deps.ctx, deps.cancelToken);
      deps.emit({ phase: "resume", node: deps.ctx.note, data: { until: ev.until } });
      if (suspendOutcome.kind === "result") {
        deps.emit({ phase: "result", node: deps.ctx.note, data: { value: suspendOutcome.value } });
        return { kind: "result" as const, value: suspendOutcome.value };
      }
      return { kind: "continue" as const };

    case "result": {
      const v = resolveMaybe(deps.profile, ev.value, deps.ctx);
      deps.emit({ phase: "result", node: deps.ctx.note, data: { value: v } });
      return { kind: "result" as const, value: v };
    }

    case "terminate": {
      const v = resolveMaybe(deps.profile, ev.value, deps.ctx);
      deps.emit({ phase: "terminate", node: deps.ctx.note, data: { value: v } });
      throw new Terminated(v);
    }
  }
};
