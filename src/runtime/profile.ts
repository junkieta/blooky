import { drip } from "../blooky-fp";
import { DripperStream, DripPlan, Prop } from "../blooky-fp-types";
import type { CancelToken, FxNote, FxRef, PerfCtx, RunnerProfile, YieldDriver, YieldHub, YieldLocator, YieldSession } from "../blooky-fx-types";
import { resolveYieldLocator } from "./yield";

export const createDefaultProfile = (deps: {
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  commit: (plan: DripPlan) => Promise<void>|void
  yieldHub: YieldHub;
  yieldDriver: YieldDriver;
}): RunnerProfile => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const resolveRef = <T>(ref: FxRef<T>, _ctx?: PerfCtx): T => deps.resolve(ref)() as T;

  const resolveSelection: RunnerProfile["resolveSelection"] = (note, ctx) => {
    if (note.type === "condition") return resolveRef(note.if, ctx) ? note.then : note.else ?? null;
    const key = resolveRef(note.by as any, ctx);
    return note.cases.get(key as any) ?? note.default ?? null;
  };

  const startYield: RunnerProfile["startYield"] = async (until, ctx) => {
    // session id は stable に（id 再利用しない）
    const id = `${ctx.executionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const session: YieldSession = { kind: "yield-session", id, until };
    deps.yieldHub.start(id);

    // locator と input の解決：あなたの until.target / until.input 型に合わせて実装
    const locator: YieldLocator = resolveYieldLocator(until, ctx, resolveRef); // ←要実装
    
    const input = until.input === undefined ? undefined : resolveRef(until.input, ctx); // ←既存 resolveRef を使う

    // driver に主権移譲（ここで template/remote/worker が分岐される）
    void Promise.resolve(
      deps.yieldDriver.requestYield({ id, locator, input, ctx })
    ).catch((e) => {
      // request 失敗は reject に落とす
      deps.yieldHub.reject(id, e);
    });

    return session;
  };

  const awaitYield: RunnerProfile["awaitYield"] = async (session, _ctx, cancelToken) => {
    await Promise.race([deps.yieldHub.await(session.id), waitCancel(cancelToken)]);
  };

  const getYieldResult: RunnerProfile["getYieldResult"] = async (session) => deps.yieldHub.get(session.id);

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

  const applyExitBoundary = async(note: FxNote, ctx: PerfCtx, result: unknown) => {
    // 1) Context 公開
    if(note.id) {
      ctx.appContext["#"+note.id] = result;
    }
    // 2) done があれば FRP 接続（必要なときだけ）
    const done = (note as any).done;
    if (done !== undefined) {
      const dripper = resolveRef<DripperStream<any>>(done, ctx);
      console.log(done,ctx);
      await deps.commit(drip(result)(dripper));
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
    applyExitBoundary
  };

  
};

const waitCancel = async (cancelToken: CancelToken) => {
  while (!cancelToken.cancelled()) {
    await new Promise((r) => setTimeout(r, 16));
  }
  throw new Error(`cancelled:${cancelToken.reason ?? "user"}`);
};
