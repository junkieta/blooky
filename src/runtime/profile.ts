import { Prop } from "../blooky-types";
import type { FxNote, FxRef, CancelToken } from "../fx/types";
import type { PerfCtx } from "./registry";
import { RETURN_VALUE } from "../fx/nodes/return";

export type EffectOutcome =
  | { kind: "none" }
  | { kind: "result"; value: unknown };

export interface RunnerProfile {
  resolveRef<T>(ref: FxRef<T>, ctx: PerfCtx): T;

  resolveSelection(
    note: Extract<FxNote, { type: "condition" | "switch" }>,
    ctx: PerfCtx
  ): FxNote | null;

  awaitSuspend(until: unknown, ctx: PerfCtx, cancelToken: CancelToken): Promise<void>;

  projectEffect(ref: unknown, ctx: PerfCtx): unknown;

  applyEffect(ref: unknown, ctx: PerfCtx): Promise<EffectOutcome>;
}

const isPromiseLike = (v: any): v is Promise<unknown> =>
  !!v && typeof v.then === "function";

export const createDefaultProfile = (deps: {
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
}): RunnerProfile => {
  const resolveRef = <T>(ref: FxRef<T>, _ctx: PerfCtx): T => deps.resolve(ref)() as T;

  const resolveSelection: RunnerProfile["resolveSelection"] = (note, ctx) => {
    if (note.type === "condition") {
      const ok = !!resolveRef(note.if as any, ctx);
      return ok ? note.then : (note.else ?? null);
    }
    const key = resolveRef(note.by as any, ctx) as any;
    return note.cases.get(key) ?? note.default ?? null;
  };

  const awaitSuspend: RunnerProfile["awaitSuspend"] = async (until: any, ctx, cancelToken) => {
    const throwIfCancelled = () => {
      if (cancelToken.cancelled()) {
        throw new Error(`cancelled:${cancelToken.reason ?? "user"}`);
      }
    };

    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, Math.max(0, ms));
        const poll = () => {
          if (cancelToken.cancelled()) {
            clearTimeout(t);
            reject(new Error(`cancelled:${cancelToken.reason ?? "user"}`));
            return;
          }
          setTimeout(poll, 16);
        };
        poll();
      });

    // default suspend handlers
    if (until?.kind === "wait") {
      if (until.ms !== undefined) {
        const ms = Number(resolveRef(until.ms as any, ctx));
        return sleep(ms);
      }
      if (until.until !== undefined) {
        const condAny = resolveRef(until.until as any, ctx) as any;
        while (true) {
          throwIfCancelled();
          const ok =
            typeof condAny === "function"
              ? !!condAny()
              : typeof condAny === "boolean"
                ? condAny
                : false;
          if (ok) return;
          await sleep(16);
        }
      }
      return;
    }

    // default yield boundary:
    // resolve target context and run its child flow in-place, then resume.
    if (until?.kind === "yield") {
      const target = resolveRef(until.for as any, ctx) as any;
      if (!target || target.type !== "context" || !target.child) {
        console.warn("[score-fx/profile] Invalid yield target, skipping:", until, ctx.executionId);
        return;
      }

      const yieldedValue = until.value === undefined ? undefined : resolveRef(until.value as any, ctx);
      const prevDollar = (ctx.appContext as any).$_;
      const prevReturn = (ctx.appContext as any)[RETURN_VALUE];

      (ctx.appContext as any).$_ = yieldedValue;
      try {
        const fx = await import("../blooky-fx");
        const prepared = fx.prepare(target.child, ctx.appContext as any, {
          resolve: deps.resolve,
          cancelToken,
          executionId: `${ctx.executionId}:yield`,
        });
        const handle = fx.execute(prepared);
        await handle.done;
      } finally {
        (ctx.appContext as any).$_ = prevDollar;
        (ctx.appContext as any)[RETURN_VALUE] = prevReturn;
      }
      return;
    }

    // 未知tokenは“待てない”ので、いったん警告＋即復帰（置換フェーズ用）
    console.warn("[score-fx/profile] Unknown suspend token, skipping:", until, ctx.executionId);
  };

  const projectEffect = (ref: unknown) => ref;

  const applyEffect: RunnerProfile["applyEffect"] = async (ref, ctx) => {
    const e: any = ref;
    if (!e || e.kind !== "call") return { kind: "none" };

    const fn = resolveRef(e.action, ctx) as any;
    const arg = e.arg === undefined ? undefined : resolveRef(e.arg, ctx);
    const thisArg = e.context === undefined ? undefined : resolveRef(e.context, ctx);

    try {
      const out = fn.call(thisArg, arg);
      const value = isPromiseLike(out) ? await out : out;
      return { kind: "result", value: { ok: true, value } };
    } catch (error) {
      return { kind: "result", value: { ok: false, error } };
    }
  };

  return { resolveRef, resolveSelection, awaitSuspend, projectEffect, applyEffect };
};
