/**
 * blooky-devtools.ts (rewrite)
 *
 * Conformance target: blooky-devtools Specification v1.0.0
 * - DevTools MUST NOT generate ordering keys
 * - Ordering MUST follow Bridge-provided tick_index only
 * - Observer failures MUST be isolated from commit/submit outcomes
 */

import { clock } from "./runtime/time";
import type { ObservedTick, CommitDripPlan } from "./runtime/time";
import type { ObservedDripPlan } from "./blooky-fv";
import type { Prop, Stream, DripperStream, Vertex, MergedStream } from "./blooky-fp-types";
import type { ExecutionStep } from "./blooky-fx-types";
import { isStream, isVertex, isChainedProp, isDripperStream, vertex } from "./blooky-fp";
import { fxdom, EffectElementTagNameMap } from "./blooky-fxdom";

export { fxdom, EffectElementTagNameMap };

type EffectSummary = CommitDripPlan;

// Bridge/Adapter must provide these. DevTools must not synthesize ordering keys.
export type BridgeTickPayload = {
  tick_index: number;
  tick_id: string | number;
  execution_id?: string;
  effects_summary: EffectSummary;
  timestamp?: number; // informative only
};

export type TickRecord = BridgeTickPayload;

type PlanSnapshot = {
  observed_at: number;
  effects_summary: EffectSummary;
};

class DevToolsTimeline {
  private records: TickRecord[] = [];

  addFromBridge(payload: BridgeTickPayload) {
    // No key generation. Reject invalid payload rather than inferring fallback order.
    if (!Number.isFinite(payload.tick_index)) {
      throw new Error("[devtools] tick_index is required from Bridge/Adapter");
    }

    const next: TickRecord = {
      tick_index: payload.tick_index,
      tick_id: payload.tick_id,
      execution_id: payload.execution_id,
      effects_summary: payload.effects_summary,
      timestamp: payload.timestamp,
    };

    const existingIdx = this.records.findIndex((r) => r.tick_index === next.tick_index);
    if (existingIdx >= 0) this.records[existingIdx] = next;
    else this.records.push(next);

    // Ordering is always by bridge-provided tick_index.
    this.records.sort((a, b) => a.tick_index - b.tick_index);

    if (this.records.length > 1000) {
      this.records.splice(0, this.records.length - 1000);
    }
  }

  getRecords(): readonly TickRecord[] {
    return this.records;
  }

  clear() {
    this.records = [];
  }
}

const timeline = new DevToolsTimeline();
const recentObservedPlans: PlanSnapshot[] = [];

function renderTickRecord(record: TickRecord) {
  const panel = document.getElementById("blooky-devtools-panel");
  if (!panel) return;

  const entry = document.createElement("div");
  entry.className = "devtools-tick-entry";
  entry.textContent = `Tick ${record.tick_index}: ${record.effects_summary.size} updates`;
  panel.insertBefore(entry, panel.firstChild);

  while (panel.children.length > 50) panel.removeChild(panel.lastChild!);
}

function renderPlanSnapshot(snapshot: PlanSnapshot) {
  const panel = document.getElementById("blooky-devtools-panel");
  if (!panel) return;

  const entry = document.createElement("div");
  entry.className = "devtools-tick-entry";
  entry.textContent = `Observed plan (tick_index unavailable): ${snapshot.effects_summary.size} updates`;
  panel.insertBefore(entry, panel.firstChild);

  while (panel.children.length > 50) panel.removeChild(panel.lastChild!);
}

/**
 * Preferred path for v1.0.0 conformance.
 * Feed Bridge/Adapter payload that already includes tick_index.
 */
export const observeBridgeTick = (payload: BridgeTickPayload) => {
  try {
    timeline.addFromBridge(payload);
    renderTickRecord(payload);
  } catch (error) {
    console.error("[devtools] Observer error (isolated):", error);
  }
};

/**
 * Optional adapter helper.
 */
export const createBridgeTickObserver = () => (payload: BridgeTickPayload) => {
  observeBridgeTick(payload);
};

let detachBridgeTickObserver: (() => void) | null = null;

/**
 * Bridge (runtime/time) の tick 通知と DevTools を接続する。
 * 返り値を呼ぶと購読解除される。
 */
export const connectClockBridgeTicks = () => {
  if (!detachBridgeTickObserver) {
    detachBridgeTickObserver = clock.observeTick((tick: ObservedTick) => {
      observeBridgeTick(tick);
    });
  }
  return () => {
    if (!detachBridgeTickObserver) return;
    detachBridgeTickObserver();
    detachBridgeTickObserver = null;
  };
};

/**
 * Legacy runtime.observeCommit(plan) path.
 * This path does not create timeline records because tick_index is not present.
 */
const devtoolsObserver = (plan: ObservedDripPlan) => {
  try {
    const snapshot: PlanSnapshot = {
      observed_at: Date.now(),
      effects_summary: plan,
    };
    recentObservedPlans.push(snapshot);
    if (recentObservedPlans.length > 1000) {
      recentObservedPlans.splice(0, recentObservedPlans.length - 1000);
    }
    renderPlanSnapshot(snapshot);
  } catch (error) {
    console.error("[devtools] Observer error (isolated):", error);
  }
};

const observedProps = new Set<Prop<any>>();

export const observeProp = (prop: Prop<any>) => {
  if (observedProps.has(prop)) return;
  observedProps.add(prop);
  const registerProp = clock.observeCommit(devtoolsObserver);
  registerProp(prop);
};

export const unobserveProp = (prop: Prop<any>) => {
  if (!observedProps.has(prop)) return;
  observedProps.delete(prop);
  clock.unobserveCommit(devtoolsObserver)(prop);
};

export const clearObservers = () => {
  observedProps.forEach((prop) => {
    clock.unobserveCommit(devtoolsObserver)(prop);
  });
  observedProps.clear();
  recentObservedPlans.splice(0, recentObservedPlans.length);
};

export const getRecentObservedPlans = (): readonly PlanSnapshot[] => recentObservedPlans;

export function dumpGraphDOT(
  entries: Record<string, Stream<any> | Prop<any> | unknown>,
  graphAttrs: Record<string, string> = { rankdir: "LR" }
): string {
  const vertex_map: [string, any][] = Object.entries(entries).map(([k, v]) => [k, isStream(v) ? vertex(v) : v]);

  const names = new WeakMap(vertex_map.map(([k, v]) => [Object(v), k]));
  const visited = new WeakMap<any, string>();
  const edges: string[] = [];
  const nodes: string[] = [];
  let counter = 0;

  function addNode(label: string, attrs: Record<string, any>) {
    const id = `n${counter++}`;
    const attrsList = [`label="${label}"`];
    if (attrs) attrsList.push(...Object.entries(attrs).map(([k, v]) => `${k}="${v}"`));
    nodes.push(`${id} [${attrsList.join(" ")}]`);
    return id;
  }

  function getShape(node: Stream<any>) {
    if (isDripperStream(node)) return "ellipse";
    if ("mapFn" in node) return "diamond";
    if ("filterFn" in node) return "triangle";
    if ("reduceFn" in node) return "hexagon";
    return "plain";
  }

  function visit(obj: Vertex|Prop<any>, label: string) {
    if (visited.has(obj)) return visited.get(obj)!;

    if (isChainedProp<any>(obj)) {
      const value = obj();
      let valueLabel: string;
      switch (typeof value) {
        case "symbol":
          valueLabel = "symbol(" + (value.description || "") + ")";
          break;
        case "string":
          valueLabel = `\\"${value.replace(/"/g, '\\"')}\\"`;
          break;
        default:
          valueLabel = String(value);
          break;
      }
      const id = addNode(label + "|" + valueLabel, {
        id: label,
        shape: "record",
        class: "prop " + (value === null ? "null" : typeof value),
      });
      visited.set(obj, id);
      return id;
    }

    if (!isVertex(obj)) {
      const id = addNode(label, { id: names.get(obj) || "unknown", shape: "circle" });
      visited.set(obj, id);
      return id;
    }

    const nodeAttr = names.has(obj)
      ? { id: "node-" + label, shape: getShape(obj.sourceStream) }
      : { shape: "point" };

    const id = addNode(label, nodeAttr);
    visited.set(obj, id);

    const next = [...(obj.next ?? []), ...(obj.lazyNext ?? [])];
    if (next.length) {
      edges.push(
        ...next.map((target) => {
          const targetLabel = names.get(target) || "Stream";
          const targetId = visit(target, targetLabel);
          return `${id} -> ${targetId}`;
        })
      );
    }

    const props = obj.props;
    if (props) {
      edges.push(...props.map((p) => `${id} -> ${visit(p, names.get(p) || "none")}`));
    }
    return id;
  }

  vertex_map.forEach(([name, streamOrProp]) => {
    visit(streamOrProp, name);
  });

  const digraph_attrs = Object.entries(graphAttrs)
    .map((v) => v.join("="))
    .join(";\n");
  return `digraph BlookyGraph {\ngraph [\n${digraph_attrs}\n];\n${nodes.join("\n")}\n${edges.join("\n")}\n}`;
}

export function dripGraph<A>(
  value: A
): (dripper: DripperStream<A>) => {
  dripper: DripperStream<A>;
  value: A;
  streams: Map<Stream<any>, any>;
  effects: Map<Prop<any>, any>;
} {
  return (dripper) => {
    const lazy = new Map<Vertex, any[]>();
    const streams = new Map<Stream<any>, any>();
    const effects = new Map<Prop<any>, any>();

    const walk = (v: any) => (vert: Vertex) => {
      streams.set(vert.sourceStream, v);
      vert.props?.forEach((p) => effects.set(p, v));

      if (vert.lazyNext) {
        vert.lazyNext.forEach((lazySource) => {
          if (lazy.has(lazySource)) lazy.get(lazySource)!.push(v);
          else lazy.set(lazySource, [v]);
        });
      }

      if (vert.next?.length) {
        vert.next
          .filter(({ sourceStream }) => !("filterFn" in sourceStream) || sourceStream.filterFn(v))
          .forEach((s) => walk("mapFn" in s.sourceStream ? s.sourceStream.mapFn(v) : v)(s));
      }
    };

    walk(value)(vertex(dripper));

    while (lazy.size) {
      const entries = [...lazy];
      lazy.clear();
      entries.forEach(([s, values]) => walk(values.reduce((s.sourceStream as MergedStream<any>).reduceFn))(s));
    }

    return { dripper, value, streams, effects };
  };
}

export function attachDevToolsPanel(container?: HTMLElement): HTMLElement {
  const target = container || document.body;

  const panel = document.createElement("div");
  panel.id = "blooky-devtools-panel";
  panel.style.cssText = `
    position: fixed;
    right: 12px;
    bottom: 12px;
    width: 320px;
    max-height: 400px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.9);
    color: #fff;
    padding: 12px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 12px;
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  `;

  const header = document.createElement("div");
  header.textContent = "Blooky DevTools";
  header.style.cssText = `
    font-weight: bold;
    margin-bottom: 8px;
    border-bottom: 1px solid #444;
    padding-bottom: 4px;
  `;
  panel.appendChild(header);

  const controls = document.createElement("div");
  controls.style.marginBottom = "8px";

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  clearBtn.style.cssText = `
    background: #333;
    color: #fff;
    border: 1px solid #666;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 4px;
    margin-right: 4px;
  `;
  clearBtn.onclick = () => {
    timeline.clear();
    recentObservedPlans.splice(0, recentObservedPlans.length);
    while (panel.children.length > 2) panel.removeChild(panel.lastChild!);
  };
  controls.appendChild(clearBtn);

  panel.appendChild(controls);
  target.appendChild(panel);

  return panel;
}

export function renderGraphSVG(entries: Record<string, Stream<any> | Prop<any>>): string {
  const dot = dumpGraphDOT(entries);
  return `<!-- ${dot} -->`;
}

export function createStepLogger(): (step: ExecutionStep) => void {
  const steps: ExecutionStep[] = [];

  return (step: ExecutionStep) => {
    try {
      steps.push(step);

      const panel = document.getElementById("blooky-devtools-steps");
      if (panel) {
        const entry = document.createElement("div");
        entry.textContent = `${step.phase}: ${step.note.type}`;
        entry.style.cssText = `
          padding: 4px;
          border-bottom: 1px solid #333;
        `;
        panel.appendChild(entry);
      }
    } catch (error) {
      console.error("[devtools] Step logger error (isolated):", error);
    }
  };
}

export { timeline, devtoolsObserver };

export function initDevTools(container?: HTMLElement): {
  panel: HTMLElement;
  observeProp: typeof observeProp;
  unobserveProp: typeof unobserveProp;
  clearObservers: typeof clearObservers;
  observeBridgeTick: typeof observeBridgeTick;
  disconnectBridgeTicks: () => void;
  timeline: typeof timeline;
} {
  const panel = attachDevToolsPanel(container);
  const disconnectBridgeTicks = connectClockBridgeTicks();

  return {
    panel,
    observeProp,
    unobserveProp,
    clearObservers,
    observeBridgeTick,
    disconnectBridgeTicks,
    timeline,
  };
}

const injectDevToolsStyles = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById("blooky-devtools-styles")) return;

  const style = document.createElement("style");
  style.id = "blooky-devtools-styles";
  style.textContent = `
    .devtools-tick-entry {
      padding: 6px 8px;
      margin-bottom: 4px;
      background: rgba(255, 255, 255, 0.05);
      border-left: 3px solid #4a9eff;
      border-radius: 3px;
      font-size: 11px;
    }

    .devtools-tick-entry:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  `;
  document.head.appendChild(style);
};

if (typeof document !== "undefined") {
  injectDevToolsStyles();
}
