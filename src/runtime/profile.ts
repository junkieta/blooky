import { drip } from "../blooky-fp";
import { DripperStream, DripPlan, Prop } from "../blooky-fp-types";
import type { CancelToken, FxNote, FxRef, PerfCtx, RunnerProfile, SuspendOutcome, SuspendUntil, YieldConditionRef, YieldDriver, YieldHub, YieldLocator, YieldSession } from "../blooky-fx-types";
import { resolveYieldLocator } from "./yield";

export const createDefaultProfile = (deps: {
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  commit: (plan: DripPlan) => Promise<void>|void;
  observeCommit: (f: (plan: Map<Prop<any>, any>) => void) => (p: Prop<any>) => () => void;
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

    const locator: YieldLocator = resolveYieldLocator(until, ctx, resolveRef);
    const input = until.input === undefined ? undefined : resolveRef(until.input, ctx);

    // driver に主権移譲（ここで template/remote/worker が分岐される）
    void Promise.resolve(
      deps.yieldDriver.requestYield({ id, locator, input, ctx })
    ).catch((e) => {
      // request 失敗は reject に落とす
      deps.yieldHub.reject(id, e);
    });

    return session;
  };
  
  const isYield = (u: unknown): u is YieldConditionRef =>
    !!u && typeof u === "object" && (u as any).kind === "yield";

  const watchPropUntilTrue = (p: Prop<boolean>) => {
    let done = false;
    let unobserve: (() => void) | undefined;

    const dispose = () => {
      if (done) return;
      done = true;
      unobserve?.();
      unobserve = undefined;
    };

    const promise = new Promise<void>((resolve, reject) => {
      const check = () => {
        try {
          if (p()) {
            dispose();
            resolve();
          }
        } catch (e) {
          dispose();
          reject(e);
        }
      };

      // 即時条件充足なら subscribe せず抜ける
      check();
      if (done) return;

      // observeCommit は pre-commit で呼ばれるため、
      // callback 引数の plan に載る「次値」を優先して判定する。
      unobserve = deps.observeCommit((plan) => {
        try {
          if (plan.has(p) && !!plan.get(p)) {
            dispose();
            resolve();
            return;
          }
          check();
        } catch (e) {
          dispose();
          reject(e);
        }
      })(p);

      // subscribe 直後に充足した場合の取りこぼし対策
      check();
    });

    return { promise, dispose };
  };

  const awaitSuspend = async (until: SuspendUntil, ctx: PerfCtx, cancel: CancelToken): Promise<SuspendOutcome> => {

    switch(until.kind) {

      case "yield": {
        const session = await startYield(until, ctx);
        await awaitYield(session, ctx, cancel);
        const value = await getYieldResult(session, ctx);
        return { kind: "result", value };
      }

      case "timer": {
        const waitMs = Number(resolveRef(until.ms, ctx));
        if (!Number.isFinite(waitMs) || waitMs < 0) {
          throw new Error(`Invalid wait ms: ${waitMs}`);
        }
        if (waitMs > 0) await sleep(waitMs);
        return { kind: "continue" };
      }

      case "ref": {
        const test = resolveRef(until.ref, ctx) as unknown;
        if (typeof test === "function") {
          const watcher = watchPropUntilTrue(test as Prop<boolean>);
          try {
            await Promise.race([watcher.promise, waitCancel(cancel)]);
          } finally {
            watcher.dispose();
          }
        }
        return { kind: "continue" };
      }

    }
  };

  const awaitYield: RunnerProfile["awaitYield"] = async (session, _ctx, cancelToken) => {
    await Promise.race([deps.yieldHub.await(session.id), waitCancel(cancelToken)]);
  };

  const getYieldResult: RunnerProfile["getYieldResult"] = async (session) => deps.yieldHub.get(session.id);

  const projectEffect = (ref: unknown) => ref;

  const applyEffect: RunnerProfile["applyEffect"] = async (ref, ctx) => {
    const e: any = ref;

    if (e?.kind !== "call") return { kind: "none" };

    const action = resolveRef(e.action, ctx) as any;
    const input = e.input === undefined ? undefined : resolveRef(e.input, ctx);

    try {
      const out = action.call(ctx.appContext, input);
      const value = out && typeof out.then === "function" ? await out : out;
      return { kind: "result", value: { ok: true, value } };
    } catch (error) {
      return { kind: "result", value: { ok: false, error } };
    }
  };

  const applyExitBoundary = async(note: FxNote, ctx: PerfCtx, result: unknown) => {
    // resultに(Prop/getterではない)関数そのものを値として返すパターンは認められないので注意
    const value = resolveRef(result, ctx);
    // 1) Context 公開
    if(note.id) {
      ctx.appContext["#"+note.id] = value;
    }
    // 2) done があれば FRP 接続（必要なときだけ）
    const done = (note as any).done;
    if (done !== undefined) {
      const dripper = resolveRef<DripperStream<any>>(done, ctx);
      await deps.commit(drip(value)(dripper));
    }
  };


  return {
    resolveRef,
    resolveSelection,
    awaitSuspend,
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
