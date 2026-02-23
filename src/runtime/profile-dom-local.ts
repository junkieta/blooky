import type { CancelToken, FxRef, PerfCtx, RunnerProfile, YieldConditionRef, YieldDriver, YieldHub, YieldLocator, YieldSession } from "../blooky-fx-types";
import { createDefaultProfile } from "./profile";
import { DripPlan, Prop } from "../blooky-fp-types";
import { isFxRefKey } from "./engine";


type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const defer = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};


type Entry =
  | { state: "pending"; p: Promise<void>; resolve: () => void; reject: (e: unknown) => void }
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; error: unknown };

export class LocalYieldHub implements YieldHub {
  private map = new Map<string, Entry>();

  start(id: string) {
    if (this.map.has(id)) return;
    let _resolve!: () => void;
    let _reject!: (e: unknown) => void;
    const p = new Promise<void>((res, rej) => {
      _resolve = res;
      _reject = rej;
    });
    this.map.set(id, { state: "pending", p, resolve: _resolve, reject: _reject });
  }

  await(id: string): Promise<void> {
    const e = this.map.get(id);
    if (!e) return Promise.reject(new Error(`[yield] unknown session id: ${id}`));
    if (e.state === "pending") return e.p;
    return Promise.resolve();
  }

  resolve(id: string, value: unknown) {
    const e = this.map.get(id);
    if (!e || e.state !== "pending") return;
    this.map.set(id, { state: "resolved", value });
    e.resolve();
  }

  reject(id: string, error: unknown) {
    const e = this.map.get(id);
    if (!e || e.state !== "pending") return;
    this.map.set(id, { state: "rejected", error });
    e.reject(error);
  }

  get(id: string): unknown {
    const e = this.map.get(id);
    if (!e) throw new Error(`[yield] unknown session id: ${id}`);
    if (e.state === "resolved") return e.value;
    if (e.state === "rejected") throw e.error;
    throw new Error(`[yield] not ready: ${id}`);
  }
}

const waitCancel = async (cancelToken: CancelToken) => {
  while (!cancelToken.cancelled()) {
    await new Promise((r) => setTimeout(r, 16));
  }
  throw new Error(`cancelled:${cancelToken.reason ?? "user"}`);
};

export const createBrowserLocalProfile = (deps: {
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  commit: (plan: DripPlan) => Promise<void>;
  yieldHub?: LocalYieldHub;
  yieldDriver: YieldDriver

}): RunnerProfile => {
  const base = createDefaultProfile({
    resolve: deps.resolve, 
    commit: deps.commit,
    yieldHub: deps.yieldHub,
    yieldDriver: deps.yieldDriver
  });
  const hub = deps.yieldHub ?? new LocalYieldHub();
  const startYield: RunnerProfile["startYield"] = async (until, ctx) => {
    const id = `${ctx.executionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const session: YieldSession = { kind: "yield-session", id, until };
    hub.start(id);
    // locator を確定（既存 until.target を使う。ref が FxRef なら resolve）
    const rawRef = until.target.ref;
    const resolvedRef =
      isFxRefKey(rawRef) || typeof rawRef === "function"
        ? base.resolveRef(rawRef as FxRef<unknown>, ctx)
        : rawRef;

    const locator: YieldLocator = { kind: until.target.kind, ref: resolvedRef } as any;
    const input = until.input === undefined ? undefined : base.resolveRef(until.input as FxRef<unknown>, ctx);
    Promise.resolve(
      deps.yieldDriver.requestYield({ id, locator, input, ctx })
    ).catch((e) => hub.reject(id, e));

    return session;
  };

  const awaitYield: RunnerProfile["awaitYield"] = async (session, _ctx, cancelToken) => {
    // 例外駆動 polling をやめる：yield 完了 or cancel のどちらか
    await Promise.race([hub.await(session.id), waitCancel(cancelToken)]);
  };

  const getYieldResult: RunnerProfile["getYieldResult"] = async (session) => {
    // 冪等（同じ値を返す）
    return hub.get(session.id);
  };

  // UI 側が完了させる API（必要なら export して fxdom 側に渡す）
  // hub.resolve(id, value) / hub.reject(id, err)

  return {
    ...base,
//    startYield,
    awaitYield,
    getYieldResult,
  };
};

