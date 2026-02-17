import { Prop } from "../blooky-fp-types";
import type { FxNote, FxRef, CancelToken } from "../blooky-fx-types";
import type { PerfCtx, YieldConditionRefV1 } from "./registry";

export type EffectOutcome =
  | { kind: "none" }
  | { kind: "result"; value: unknown };

export type YieldSession = {
  kind: "yield-session-v1";
  id: string;
  until: YieldConditionRefV1;
};

export interface RunnerProfile {
  resolveRef<T>(ref: FxRef<T>, ctx: PerfCtx): T;

  resolveSelection(
    note: Extract<FxNote, { type: "condition" | "switch" }>,
    ctx: PerfCtx
  ): FxNote | null;

  // Yield v1 lifecycle
  startYield(until: YieldConditionRefV1, ctx: PerfCtx): Promise<YieldSession>;
  awaitYield(session: YieldSession, ctx: PerfCtx, cancelToken: CancelToken): Promise<void>;
  getYieldResult(session: YieldSession, ctx: PerfCtx): Promise<unknown>;

  projectEffect(ref: unknown, ctx: PerfCtx): unknown;
  applyEffect(ref: unknown, ctx: PerfCtx): Promise<EffectOutcome>;
}

export const createDefaultProfile = (deps: {
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  // yield は未実装（ブラウザ向け/remote向けは別profileで差し替え）
}): RunnerProfile => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const resolveRef = <T>(ref: FxRef<T>, _ctx?: PerfCtx): T => deps.resolve(ref)() as T;

  const resolveSelection: RunnerProfile["resolveSelection"] = (note, ctx) => {
    if (note.type === "condition") return resolveRef(note.if, ctx) ? note.then : note.else ?? null;
    const key = resolveRef(note.by as any, ctx);
    return note.cases.get(key as any) ?? note.default ?? null;
  };

  const startYield: RunnerProfile["startYield"] = async (until, ctx) => {
    // id 生成規則は deterministic に寄せてもよい（ここは最小）
    const id = `${ctx.executionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    return { kind: "yield-session-v1", id, until };
  };

  const awaitYield: RunnerProfile["awaitYield"] = async () => {
    throw new Error("yield-v1 is not implemented in default profile; provide a browser/remote profile");
  };

  const getYieldResult: RunnerProfile["getYieldResult"] = async () => {
    throw new Error("yield-v1 is not implemented in default profile; provide a browser/remote profile");
  };

  const projectEffect = (ref: unknown) => ref;

  const applyEffect: RunnerProfile["applyEffect"] = async (ref, ctx) => {
    const e: any = ref;
    if (e?.kind === "wait") {
      const waitMs = e.ms === undefined ? 0 : Number(resolveRef(e.ms, ctx));
      if (Number.isFinite(waitMs) && waitMs > 0) {
        await sleep(waitMs);
      }

      if (e.until !== undefined) {
        const until = resolveRef(e.until, ctx) as unknown;
        if (typeof until === "function") {
          while (!(until as () => boolean)()) {
            await sleep(16);
          }
        }
      }

      return { kind: "result", value: undefined };
    }

    if (e?.kind !== "call") return { kind: "none" };

    const fn = resolveRef(e.action, ctx) as any;
    const arg = e.arg === undefined ? undefined : resolveRef(e.arg, ctx);
    const thisArg = e.context === undefined ? undefined : resolveRef(e.context, ctx);

    try {
      const out = fn.call(thisArg, arg);
      const value = out && typeof out.then === "function" ? await out : out;
      return { kind: "result", value: { ok: true, value } };
    } catch (error) {
      return { kind: "result", value: { ok: false, error } };
    }
  };

  return {
    resolveRef,
    resolveSelection,
    startYield,
    awaitYield,
    getYieldResult,
    projectEffect,
    applyEffect,
  };
};
