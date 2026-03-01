import { isChainedProp } from "../blooky-fp";
import { DripperStream, DripPlan, Prop, PropPlan } from "../blooky-fp-types";
import type { CancelToken, FxNote, FxRef, PerfCtx, RunnerProfile, SuspendOutcome, SuspendUntil, YieldConditionRef, YieldDriver, YieldHub, YieldLocator, YieldSession } from "../blooky-fx-types";
import { resolveYieldLocator } from "./yield";

export const createDefaultProfile = (deps: {
  commit: (plan: DripPlan<any>) => Promise<void>|void;
  observeCommit: (f: (plan: Map<Prop<any>, any>) => void) => (p: Prop<any>) => () => void;
  yieldHub: YieldHub;
  yieldDriver: YieldDriver;
}): RunnerProfile => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const resolveRef = <T>(ref: FxRef<T>, _ctx?: PerfCtx): Prop<T> => _ctx.execContext.resolver(ref, _ctx);

  const resolveSelection: RunnerProfile["resolveSelection"] = (note, ctx) => {
    if (note.type === "condition") return resolveRef(note.if, ctx)() ? note.then : note.else ?? null;
    const key = resolveRef(note.by as any, ctx)();
    return note.cases.get(key as any) ?? note.default ?? null;
  };

  const startYield: RunnerProfile["startYield"] = async (until, ctx) => {
    // session id は stable に（id 再利用しない）
    const id = `${ctx.executionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const session: YieldSession = { kind: "yield-session", id, until };
    deps.yieldHub.start(id);

    const locator: YieldLocator = resolveYieldLocator(until, ctx);
    const input = until.input === undefined ? undefined : resolveRef(until.input, ctx)();

    // driver に主権移譲（ここで template/remote/worker が分岐される）
    void Promise.resolve(
      deps.yieldDriver.requestYield({ id, locator, input, ctx })
    ).catch((e) => {
      // request 失敗は reject に落とす
      deps.yieldHub.reject(id, e);
    });

    return session;
  };
  
  const watchPropUntilTrue = (p: Prop<boolean>) => {
    if(p()) return Promise.resolve();
    if(!isChainedProp(p)) return new Promise(async (resolve) => {
      while(!(p as ()=>boolean)()) await sleep(16);
      resolve(void 0);
    });
    let dispose = () => {};
    return new Promise((resolve) => {
      if(p()) {
        resolve(void 0);
      } else {
        dispose = deps.observeCommit((plan) => {
          if (plan.has(p) && plan.get(p) === true) {
            resolve(void 0);
            dispose();
          }
        })(p);
      }
    }).finally(()=>dispose());
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
        const waitMs = Number(resolveRef(until.ms, ctx)());
        if (!Number.isFinite(waitMs) || waitMs < 0) {
          throw new Error(`Invalid wait ms: ${waitMs}`);
        }
        if (waitMs > 0) await sleep(waitMs);
        return { kind: "continue" };
      }

      case "ref": {
        const test = resolveRef(until.ref, ctx) as unknown;
        const watcher = watchPropUntilTrue(test as Prop<boolean>);
        await Promise.race([watcher, waitCancel(cancel)]);
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

    // action は 関数自体を参照する可能性が高い
    const action = resolveRef(e.action, ctx) as any;
    const input = e.input === undefined ? undefined : resolveRef(e.input, ctx)();

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
    const value = resolveRef(result, ctx)();
    // 1) Context 公開
    if(note.id) {
      ctx.execContext.idSlots["#"+note.id] = value;
    }
    // 2) done があれば FRP 接続（必要なときだけ）
    const done = (note as any).done;
    if (done !== undefined) {
      await deps.commit({ dripper: resolveRef<DripperStream<any>>(done, ctx)(), value });
    }
  };


  return {
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
