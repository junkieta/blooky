// runtime/yield-hub-local.ts

import { FxRef, PerfCtx, YieldConditionRef, YieldDriver, YieldHub, YieldLocator, YieldRequest, YieldTargetRef } from "../blooky-fx-types";

type Entry =
  | { state: "pending"; p: Promise<void>; resolve: () => void; reject: (e: unknown) => void }
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; error: unknown };

export class LocalYieldHub implements YieldHub {
  private map = new Map<string, Entry>();

  start(id: string) {
    if (this.map.has(id)) return; // 二重 start は無視 or throw（方針）
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
    if (!e) return Promise.reject(new Error(`[yieldhub] unknown id: ${id}`));
    if (e.state === "pending") return e.p;
    return Promise.resolve();
  }

  resolve(id: string, value: unknown) {
    const e = this.map.get(id);
    if (!e) return;
    if (e.state === "pending") {
      this.map.set(id, { state: "resolved", value });
      e.resolve();
    }
  }

  reject(id: string, error: unknown) {
    const e = this.map.get(id);
    if (!e) return;
    if (e.state === "pending") {
      this.map.set(id, { state: "rejected", error });
      e.reject(error);
    }
  }

  get(id: string): unknown {
    const e = this.map.get(id);
    if (!e) throw new Error(`[yieldhub] unknown id: ${id}`);
    if (e.state === "resolved") return e.value;
    if (e.state === "rejected") throw e.error;
    throw new Error(`[yieldhub] not ready: ${id}`);
  }
}


// runtime/yield-driver-composite.ts

export type YieldDriverMap = Partial<Record<YieldLocator["kind"], YieldDriver>>;

export class CompositeYieldDriver implements YieldDriver {
  constructor(private drivers: YieldDriverMap) {}

  requestYield(req: YieldRequest): void | Promise<void> {
    const d = this.drivers[req.locator.kind];
    if (!d) throw new Error(`[yield] no driver for locator.kind=${req.locator.kind}`);
    return d.requestYield(req);
  }
}


// fxdom/yield-driver-template.ts
import { executeByElement, type FxEffectElement } from "../blooky-fxdom"; // 実際の型に合わせて
import { isFxRefKey, RETURN_VALUE } from "./engine";

type Deps = {
  hub: YieldHub;

  /** templateId -> HTMLTemplateElement 解決 */
  getTemplateById?: (id: string) => HTMLTemplateElement | null;

  /** clone を DOM に attach する親（connected要件を満たすため） */
  attachParent: Element; // 例：root fx-effect element

  /** 実行時の appContext / execContext をどう渡すか（必要なら） */
  // appContext?: Record<string|symbol, any>;
  // execContextOverride?: any;
};

export class TemplateYieldDriver implements YieldDriver {
  constructor(private deps: Deps) {}

  async requestYield(req: YieldRequest): Promise<void> {
    const { id, locator, input } = req;
    try {
      let template: HTMLTemplateElement | null = null;

      if (locator.kind === "template-el") template = locator.el;
      else if (locator.kind === "template") {
        const get = this.deps.getTemplateById ?? ((x) => document.getElementById(x) as any);
        template = get(locator.templateId);
      } else {
        throw new Error(`[yield/template] invalid locator.kind=${(locator as any).kind}`);
      }

      if (!template) throw new Error("[yield/template] template not found");

      // 1) clone
      const frag = template.content.cloneNode(true) as DocumentFragment;

      // 2) 実行対象のルートを決める（fx-effect 推奨。fx-context なら入口を追加）
      const host = document.createElement("fx-effect") as FxEffectElement;
      host.id = "YIELDED" + id;
      host.appendChild(frag);
      // 3) connected 要件のため attach
      this.deps.attachParent.appendChild(host);
      // 4) 実行（input を渡したいなら appContext や attribute 経由など、方針を決める）
      const app: Record<string | symbol, any> = {};
      if (input !== undefined) (app as any)["$_"] = input;

      const handle = executeByElement(host, app, /* ctx */ undefined);
      await handle.done; // ← 例：handle.result が Promise<unknown> だと仮定
      host.remove();

      // 5) resolve
      this.deps.hub.resolve(id, app[RETURN_VALUE]);
    } catch (e) {
      this.deps.hub.reject(id, e);
    }
  }
}

// runtime/yield-driver-remote.ts

type RemoteClient = {
  requestYield: (endpoint: string, payload: { id: string; locator: unknown; input?: unknown; executionId?: string }) => Promise<void>;
  // remote 側から結果が返る channel（実装依存）
  onYieldResult: (fn: (msg: { id: string; ok: boolean; value?: unknown; error?: unknown }) => void) => () => void;
};

export class RemoteYieldDriver implements YieldDriver {
  private detach?: () => void;

  constructor(private deps: { hub: YieldHub; client: RemoteClient }) {
    // 結果受信を購読
    this.detach = this.deps.client.onYieldResult((msg) => {
      if (msg.ok) this.deps.hub.resolve(msg.id, msg.value);
      else this.deps.hub.reject(msg.id, msg.error);
    });
  }

  async requestYield(req: YieldRequest): Promise<void> {
    if (req.locator.kind !== "remote") throw new Error("invalid locator");
    await this.deps.client.requestYield(req.locator.endpoint, {
      id: req.id,
      locator: req.locator.locator,
      input: req.input,
      executionId: req.ctx.executionId,
    });
  }

  dispose() {
    this.detach?.();
    this.detach = undefined;
  }
}

// base.resolveRef を引数でもらう（default profile の resolveRef を使う想定）
export const resolveYieldLocator = (
  until: YieldConditionRef,
  ctx: PerfCtx,
  resolveRef: <T>(ref: FxRef<T>, ctx: PerfCtx) => T
): YieldLocator => {
  if (until.kind !== "yield") throw new Error("unsupported yield condition");
  const t = until.target;
  const raw = (t as any).ref;
  const resolved =
    isFxRefKey(raw) || typeof raw === "function"
      ? resolveRef(raw as FxRef<unknown>, ctx) || document.getElementById(raw.key?.slice(1))
      : raw;

  if (typeof raw === "string") return { kind: "template", templateId: raw };
  if (resolved instanceof HTMLTemplateElement) return { kind: "template-el", el: resolved };
  if (raw?.kind === "template" && raw.el instanceof HTMLTemplateElement) return raw;
  if (raw?.kind === "template-id" && typeof raw.id === "string") return raw;

  throw new Error("Unsupported local yield target ref (expected {kind:'template'|'template-id', ...})");
};

