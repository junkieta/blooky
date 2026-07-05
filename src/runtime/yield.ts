// runtime/yield-hub-local.ts

import { query } from "../blooky-fx";
import { ExecutionContext, YieldDriver, YieldHub, YieldLocator, YieldRequest } from "../blooky-fx-types";
import { createChildCancelToken } from "./cancel-token";

// Internal Hub implementation for RemoteYieldDriver only
type Entry =
  | { state: "pending"; p: Promise<void>; resolve: () => void; reject: (e: unknown) => void }
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; error: unknown };

class LocalYieldHub implements YieldHub {
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

  requestYield(req: YieldRequest): void | Promise<unknown> {
    const d = this.drivers[req.locator.kind];
    if (!d) throw new Error(`[yield] no driver for locator.kind=${req.locator.kind}`);
    return d.requestYield(req);
  }
}


// fxdom/yield-driver-template.ts
import { FxFlowElement } from "../blooky-fxdom"; // 実際の型に合わせて
import { isFxRefKey } from "./engine";

type Deps = {
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

  async requestYield(req: YieldRequest): Promise<unknown> {
    const { id, locator, input } = req;
    let dispose : ()=>void = () => {};
    try {
      let template: HTMLTemplateElement | null = null;

      if (locator.kind === "template-el")
        template = locator.el;
      else if (locator.kind === "template") {
        const get = this.deps.getTemplateById ?? ((x) => document.getElementById(x) as any);
        template = get(locator.templateId);
      } else {
        throw new Error(`[yield/template] invalid locator.kind=${(locator as any).kind}`);
      }

      if (!template || template.tagName !== "TEMPLATE") throw new Error("[yield/template] template not found");

      // 実行対象のルートを決める
      const host = document.createElement("fx-flow") as FxFlowElement;
      host.id = "YIELDED" + id;
      host.setContext(req.ctx.appContext);
      host.appendChild(template.content.cloneNode(true));
      // gc
      dispose = host.remove.bind(host);
      // connected 要件のため attach
      this.deps.attachParent.appendChild(host);

      const childCancelToken = createChildCancelToken(req.ctx.cancelToken);
      const handle = query(host.toFxNote(), req.ctx.appContext, {
        idSlots: input ? { $_: input } : undefined,
        cancelToken: childCancelToken,
        executionId: `${req.ctx.executionId}:yield:${id}`,
      });
      const result = await handle.done;

      return result;
    } catch (e) {
      throw e;
    } finally {
      dispose();
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
  private hub: LocalYieldHub;

  constructor(private deps: { client: RemoteClient }) {
    // Remote driver creates its own Hub for out-of-band result reception
    this.hub = new LocalYieldHub();
    // 結果受信を購読
    this.detach = this.deps.client.onYieldResult((msg) => {
      if (msg.ok) this.hub.resolve(msg.id, msg.value);
      else this.hub.reject(msg.id, msg.error);
    });
  }

  async requestYield(req: YieldRequest): Promise<unknown> {
    if (req.locator.kind !== "remote") throw new Error("invalid locator");
    this.hub.start(req.id);
    await this.deps.client.requestYield(req.locator.endpoint, {
      id: req.id,
      locator: req.locator.locator,
      input: req.input,
      executionId: req.ctx.executionId,
    });
    // Remote driver uses Hub for out-of-band result reception
    return this.hub.await(req.id).then(() => this.hub.get(req.id));
  }

  dispose() {
    this.detach?.();
    this.detach = undefined;
  }
}

