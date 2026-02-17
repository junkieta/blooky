import type { CancelToken, FxRef } from "../blooky-fx-types";
import type { PerfCtx, YieldConditionRefV1, YieldTargetRefV1 } from "./registry";
import type { RunnerProfile, YieldSession, EffectOutcome } from "./profile";
import { createDefaultProfile } from "./profile";
import { Prop } from "../blooky-fp-types";

type LocalTarget =
  | { kind: "template"; el: HTMLTemplateElement }
  | { kind: "template-id"; id: string };

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const defer = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

class LocalYieldHub {
  private pending = new Map<string, Deferred<unknown>>();
  private resolved = new Map<string, unknown>();

  start(id: string) {
    if (this.pending.has(id) || this.resolved.has(id)) {
      throw new Error(`Yield session already exists: ${id}`);
    }
    const d = defer<unknown>();
    this.pending.set(id, d);
    return d;
  }

  resolve(id: string, value: unknown) {
    const d = this.pending.get(id);
    if (!d) return false;
    this.pending.delete(id);
    this.resolved.set(id, value);
    d.resolve(value);
    return true;
  }

  reject(id: string, error: unknown) {
    const d = this.pending.get(id);
    if (!d) return false;
    this.pending.delete(id);
    d.reject(error);
    return true;
  }

  async await(id: string) {
    const d = this.pending.get(id);
    if (!d) throw new Error(`No pending yield session: ${id}`);
    return d.promise;
  }

  get(id: string) {
    if (!this.resolved.has(id)) throw new Error(`No resolved yield session: ${id}`);
    return this.resolved.get(id);
  }
}

const boundTemplateBridge = new WeakSet<EventTarget>();

const bindTemplateBridge = (target: EventTarget, hub: LocalYieldHub) => {
  if (boundTemplateBridge.has(target)) return;
  boundTemplateBridge.add(target);

  target.addEventListener("fx-yield-resolve", (ev: Event) => {
    const detail = (ev as CustomEvent<{ id?: unknown; value?: unknown }>).detail;
    if (!detail || typeof detail.id !== "string") return;
    hub.resolve(detail.id, detail.value);
  });

  target.addEventListener("fx-yield-reject", (ev: Event) => {
    const detail = (ev as CustomEvent<{ id?: unknown; error?: unknown }>).detail;
    if (!detail || typeof detail.id !== "string") return;
    hub.reject(detail.id, detail.error);
  });
};

const resolveLocalTarget = (t: YieldTargetRefV1): LocalTarget => {
  if (t.kind !== "local") throw new Error("not local target");
  const r: any = t.ref;

  if (typeof r === "string") return { kind: "template-id", id: r };
  if (r instanceof HTMLTemplateElement) return { kind: "template", el: r };
  if (r?.kind === "template" && r.el instanceof HTMLTemplateElement) return r as LocalTarget;
  if (r?.kind === "template-id" && typeof r.id === "string") return r as LocalTarget;

  throw new Error("Unsupported local yield target ref (expected {kind:'template'|'template-id', ...})");
};

const isFxRefKey = (v: unknown): v is { __fxRefKey: true; key: string } =>
  !!v && typeof v === "object" && (v as any).__fxRefKey === true && typeof (v as any).key === "string";

const waitCancel = async (cancelToken: CancelToken) => {
  while (!cancelToken.cancelled()) {
    await new Promise((r) => setTimeout(r, 16));
  }
  throw new Error(`cancelled:${cancelToken.reason ?? "user"}`);
};

export const createBrowserLocalProfile = (deps: {
  resolve: <T>(ref: FxRef<T>) => Prop<T>;
  getTemplateById?: (id: string) => HTMLTemplateElement | null;
  hub?: LocalYieldHub;
}): RunnerProfile => {
  const base = createDefaultProfile({ resolve: deps.resolve });

  const hub = deps.hub ?? new LocalYieldHub();
  const getTemplateById = deps.getTemplateById ?? ((id) => document.getElementById(id) as any);

  const startYield: RunnerProfile["startYield"] = async (until, ctx) => {
    const id = `${ctx.executionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const session: YieldSession = { kind: "yield-session-v1", id, until };

    // 副作用開始はここ（契約一貫性）
    if (until.kind !== "yield-v1") throw new Error("unsupported yield condition");
    if (until.target.kind !== "local") throw new Error("browser local profile only supports target.kind=local");

    const rawTargetRef = until.target.ref;
    const resolvedTargetRef =
      isFxRefKey(rawTargetRef) || typeof rawTargetRef === "function"
        ? base.resolveRef(rawTargetRef as FxRef<unknown>, ctx)
        : rawTargetRef;

    const target = resolveLocalTarget({ kind: "local", ref: resolvedTargetRef });
    const template =
      target.kind === "template"
        ? target.el
        : (getTemplateById(target.id) ?? null);

    if (!template) throw new Error(`template not found: ${(target as any).id}`);

    hub.start(id);
    bindTemplateBridge(template, hub);

    const input = until.input === undefined ? undefined : base.resolveRef(until.input as FxRef<unknown>, ctx);

    template.dispatchEvent(
      new CustomEvent("fx-yield-start", {
        detail: { id, input, executionId: ctx.executionId, meta: until.meta ?? {} },
        bubbles: true,
        composed: true,
      })
    );

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
    startYield,
    awaitYield,
    getYieldResult,
  };
};

export { LocalYieldHub };
