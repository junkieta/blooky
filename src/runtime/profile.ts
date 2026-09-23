import { isChainedProp } from "../blooky-fp";
import { Prop } from "../blooky-fp-types";
import { FVRuntime } from "../blooky-fv";
import type { CancelToken, FxNote, FxRef, OutcomeBase, ExecutionContext, RunnerProfile, SuspendOutcome, SuspendUntil, YieldConditionRef, YieldDriver, YieldLocator } from "../blooky-fx-types";

export const isOutcome = <T>(v: unknown) : v is OutcomeBase<T> => {
  const value = v as OutcomeBase<T>;
  if(value) switch(value.kind) {
    case "cancel": return true;
    case "crash": return typeof value.source === "string" && "error" in value;
    case "error": return "error" in value;
    case "timeout": return true;
    case "value": return "value" in value;
  }
  return false;
}

export const createDefaultProfile = (deps: {
  runtime: FVRuntime;
  yieldDriver: YieldDriver;
  resolveYieldLocator: (until: YieldConditionRef, ctx: ExecutionContext) => YieldLocator;
}): RunnerProfile => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const resolveRef = <T>(ref: FxRef<T>, ctx: ExecutionContext): Prop<T> => ctx.config.resolver(ref, ctx);

  const startYield = async (until: YieldConditionRef, ctx: ExecutionContext) => {
    const locator: YieldLocator = deps.resolveYieldLocator(until, ctx);
    const input = until.input === undefined ? undefined : resolveRef(until.input, ctx)();
    const id = `${ctx.executionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    // driver に主権移譲（ここで template/remote/worker が分岐される）
    // driver の Promise を直接待つ（Hub を仲介しない）
    const result = await deps.yieldDriver.requestYield({
      id,
      locator,
      input,
      ctx,
      onStep: ctx.config.stepObserver,
    });

    return result;
  };
  
  const watchPropUntilTrue = async (p: Prop<boolean>) => {
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
        dispose = deps.runtime.observeCommit((plan) => {
          if (plan.has(p) && plan.get(p) === true) {
            resolve(void 0);
            dispose();
          }
        })(p);
      }
    }).finally(()=>dispose());
  };
  
  const awaitSuspend = async (
    until: SuspendUntil,
    ctx: ExecutionContext,
  ): Promise<SuspendOutcome<unknown>> => {

    const cancel = ctx.cancelToken;

    switch (until.kind) {

      case "yield": {
        try {
          const raw = await Promise.race([startYield(until, ctx), waitCancel(cancel)]);
          return (isOutcome(raw) && (raw.kind === "value" || raw.kind === "crash"))
            ? raw
             // yield で error は直接返さず、child由来の timeout/cancel も昇格させない
            : { kind: "value", value: raw };
        } catch (error) {
          // 親 yield 境界自身の制御結果
          if (cancel.cancelled()) return { kind: "cancel", reason: cancel.reason };
          return { kind: "crash", error, source: "host" };
        }
      }

      case "timer": {
        const waitMs = Number(resolveRef(until.timer, ctx)());
        if (!Number.isFinite(waitMs) || waitMs < 0) {
          return { kind: "crash", error: new Error(`Invalid wait timer: ${waitMs}`), source: "runner" };
        }
        if (waitMs > 0) await sleep(waitMs);
        return { kind: "continue" };
      }

      case "ref": {
        try {
          const test = resolveRef(until.ref, ctx) as unknown as Prop<boolean>;
          await Promise.race([watchPropUntilTrue(test), waitCancel(cancel)]);
          return { kind: "continue" };
        } catch (error) {
          if (cancel.cancelled()) return { kind: "cancel", reason: cancel.reason };
          return { kind: "crash", error, source: "runner" };
        }
      }
    }
  };


  return {
    awaitSuspend,
  };

  
};

const waitCancel = async (cancelToken: CancelToken) => {
  if (cancelToken.cancelled()) {
    throw new Error(`cancelled:${cancelToken.reason ?? "user"}`);
  }
  await new Promise<void>((_resolve, reject) => {
    let unsubscribe = () => {};
    unsubscribe = cancelToken.onCancel((reason) => {
      unsubscribe();
      reject(new Error(`cancelled:${reason}`));
    });
  });
};

