import type { SemanticEvent, PerfCtx, StepSink, YieldConditionRefV1 } from "./registry";
import type { RunnerProfile } from "./profile";
import type { CancelToken, FxRef } from "../blooky-fx-types";

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

export type DispatchDeps = {
  profile: RunnerProfile;
  ctx: PerfCtx;
  cancelToken: CancelToken;
  emit: StepSink;
};

const isYieldV1 = (u: unknown): u is YieldConditionRefV1 =>
  !!u && typeof u === "object" && (u as any).kind === "yield-v1";

export const dispatchEvent = async (ev: SemanticEvent, deps: DispatchDeps) => {
  if (deps.cancelToken.cancelled()) throw new Cancelled(deps.cancelToken.reason ?? "user");

  switch (ev.type) {
    case "effect": {
      const projected = deps.profile.projectEffect(ev.ref, deps.ctx);
      deps.emit({ phase: "effect", note: deps.ctx.note, data: projected });

      const applied = await deps.profile.applyEffect(ev.ref, deps.ctx);
      if (applied.kind === "result") {
        deps.emit({ phase: "result", note: deps.ctx.note, data: { value: applied.value } });
        return { kind: "result" as const, value: applied.value };
      }
      return { kind: "continue" as const };
    }

    case "suspend": {
      // yield-v1 専用
      if (!isYieldV1(ev.until)) throw new Error("Unsupported suspend condition (expected yield-v1)");
      deps.emit({ phase: "suspend", note: deps.ctx.note, data: { until: ev.until } });

      const session = await deps.profile.startYield(ev.until, deps.ctx);
      await deps.profile.awaitYield(session, deps.ctx, deps.cancelToken);
      const value = await deps.profile.getYieldResult(session, deps.ctx);

      deps.emit({ phase: "resume", note: deps.ctx.note, data: { until: ev.until } });
      deps.emit({ phase: "result", note: deps.ctx.note, data: { value } });

      return { kind: "result" as const, value };
    }

    case "result":
      {
        const value = deps.profile.resolveRef(ev.value as FxRef<unknown>, deps.ctx);
        deps.emit({ phase: "result", note: deps.ctx.note, data: { value } });
        return { kind: "result" as const, value };
      }

    case "terminate":
      {
        const value = deps.profile.resolveRef(ev.value as FxRef<unknown>, deps.ctx);
        deps.emit({ phase: "terminate", note: deps.ctx.note, data: { value } });
        throw new Terminated(value);
      }
  }
};
