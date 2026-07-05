import { isChainedProp } from "../blooky-fp";
import { Prop } from "../blooky-fp-types";
import { FVRuntime } from "../blooky-fv";
import type { CancelToken, FxNote, FxRef, OutcomeBase, ExecutionContext, RunnerProfile, SuspendOutcome, SuspendUntil, YieldDriver, YieldLocator } from "../blooky-fx-types";
import { resolveYieldLocator } from "../blooky-fxdom";

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
}): RunnerProfile => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const resolveRef = <T>(ref: FxRef<T>, _ctx?: ExecutionContext): Prop<T> => _ctx.config.resolver(ref, _ctx);

  const resolveSelection: RunnerProfile["resolveSelection"] = (note, ctx) => {
    if (note.type === "condition") {
      const raw = resolveRef(note.if, ctx)(); 
      return (isOutcome(raw) ? raw.kind === "value" && !!raw.value : !!raw)
        ? note.then
        : note.else ?? null;
    } else {
      const raw = resolveRef(note.by as any, ctx)();
      const key = !isOutcome(raw)
        ? raw
        : raw.kind === "value"
        ? raw.value
        : raw.kind;
      // まず正規化キーで探す
      if (note.cases.has(key as any)) return note.cases.get(key as any)!;
      // switchの入力が Outcome(value) かつ payloadキー不一致なら kind でフォールバック
      return note.cases.has("value" as any) && isOutcome(raw) && raw.kind === "value"
        ? note.cases.get("value" as any)!
        : note.default ?? null;
    }
  };

  const startYield = async (until, ctx) => {
    const locator: YieldLocator = resolveYieldLocator(until, ctx);
    const input = until.input === undefined ? undefined : resolveRef(until.input, ctx)();
    const id = `${ctx.executionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    // driver に主権移譲（ここで template/remote/worker が分岐される）
    // driver の Promise を直接待つ（Hub を仲介しない）
    const result = await deps.yieldDriver.requestYield({ id, locator, input, ctx });

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


  const projectEffect = (ref: unknown) => ref;

  const applyEffect: RunnerProfile["applyEffect"] = async (ref, ctx) => {
    const e: any = ref;
    if (e?.kind !== "call") return { kind: "none" };

    if (ctx.cancelToken.cancelled()) {
      return { kind: "cancel", reason: ctx.cancelToken.reason };
    }

    try {
      const action = resolveRef(e.action, ctx) as any;
      const input = e.input === undefined ? undefined : resolveRef(e.input, ctx)();
      const callable = action.FX_CALL_ACTION_PROP ? action() : action;
      const raw = await Promise.resolve(callable.call(ctx.appContext, input));
      return isOutcome(raw) ? raw : { kind: "value", value: raw };
    } catch (error) {
      return { kind: "crash", error, source: "action" };
    }
  };

  return {
    resolveSelection,
    awaitSuspend,
    projectEffect,
    applyEffect,
  };

  
};

const waitCancel = async (cancelToken: CancelToken) => {
  while (!cancelToken.cancelled()) {
    await new Promise((r) => setTimeout(r, 16));
  }
  throw new Error(`cancelled:${cancelToken.reason ?? "user"}`);
};

