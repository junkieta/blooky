import {
  fxdom,
  executeByElement as defaultExecuteByElement,
  EffectElementTagNameMap as DefaultEffectElementTagNameMap,
  FxEffectElement as ConcreteEffectElementConstructor,
  FxEffectElement,
} from "./blooky-fxdom";
import type { AppContext, FxRuntime, FxNote, PerformanceStep } from "./blooky-fx-types";

import { isChainedProp, isDripperStream, isStream, isVertex, Prop, Stream, vertex } from "./blooky-fp";
import { Vertex, DripperStream, MergedStream } from "./blooky-fp-types";

// ---------------------------------------------------------------------------
// FxDOM injection (core projection primitives)
// ---------------------------------------------------------------------------

/**
 * FxNote ↔ EffectElement binding.
 * NOTE: Spec recommends external binding tables (WeakMap), not embedding into FxNote.
 */
const FxElementStates = new WeakMap<HTMLElement, CustomStateSet>();
type NoteElementCollector = (noteId: string, element: HTMLElement) => void;
type NoteElementResolver = (noteId: string, executionId: string) => HTMLElement | undefined;
let activeNoteElementCollector: NoteElementCollector | null = null;

export const getFxElement = (
  bindings: ReadonlyMap<string, HTMLElement>,
  noteId: string
): HTMLElement | undefined => bindings.get(noteId);
export const getFxElementStates = (el: HTMLElement): CustomStateSet | undefined => FxElementStates.get(el);

// ---- Stylesheets (dev-only visual aid) ----

const devtoolsCSSPath = ["./blooky-devtools-nested.css", "./blooky-devtools-theme.css"];

/**
 * Load style sheets for EffectElement projections.
 * Failure MUST be isolated.
 */
const DevEffectElementStyleSheets: Promise<CSSStyleSheet[]> = Promise.all(
  devtoolsCSSPath.map(async (path) => {
    try {
      const res = await fetch(path);
      const text = await res.text();
      const sheet = new CSSStyleSheet();
      await sheet.replace(text);
      return sheet;
    } catch (e) {
      console.warn("[devtools] Failed to load stylesheet:", path, e);
      // Return an empty sheet to keep adoptedStyleSheets stable.
      return new CSSStyleSheet();
    }
  })
).catch((e) => {
  console.warn("[devtools] Stylesheet loading failed (isolated):", e);
  return [];
});

// ---- Dynamic extends for all EffectElements ----

/**
 * Dev-only EffectElementTagNameMap.
 * - Adds CustomStateSet-based projection
 * - Adds small ShadowRoot label UI for debugging/inspection
 *
 * IMPORTANT: This map MUST be passed to fxdom.defineEffectElements() by the entry-point.
 * This module does not call defineEffectElements() by itself.
 */
const EffectElementTagNameMap: typeof DefaultEffectElementTagNameMap = Object.fromEntries(
  new Map(Object.entries(DefaultEffectElementTagNameMap))
) as any;

Object.entries(EffectElementTagNameMap).forEach(([tag, fxClass]) => {

  EffectElementTagNameMap[tag as keyof typeof EffectElementTagNameMap] = class extends (
    fxClass as typeof ConcreteEffectElementConstructor
  ) {
    constructor() {
      super();
      try {
        const internals = this.attachInternals();
        FxElementStates.set(this, internals.states);
      } catch (e) {
        // attachInternals may be unavailable in some environments; isolate.
        console.warn("[devtools] attachInternals unavailable (isolated):", e);
      }
    }

  connectedCallback() {
    super.connectedCallback();

    const shadow = this.shadowRoot || this.attachShadow({ mode: "open" });

    DevEffectElementStyleSheets.then((sheets) => {
      try {
        // Avoid duplicates if possible
        const existing = new Set(shadow.adoptedStyleSheets);
        const next = sheets.filter((s) => !existing.has(s));
        if (next.length) shadow.adoptedStyleSheets.push(...next);
      } catch (e) {
        console.warn("[devtools] adoptedStyleSheets failed (isolated):", e);
      }
    });

    // Insert selector label once
    if (!shadow.querySelector(":scope > code.selector")) {
      shadow.insertBefore(toSelectorExpression(this), shadow.firstChild);
    }

    if (!shadow.querySelector("slot")) {
      shadow.append(document.createElement("slot"));
    }
  }

  toFxNote(): FxNote {
    const result = super.toFxNote() as FxNote;
    activeNoteElementCollector?.(resolveNoteId(result), this);
    return result;
  }
} as any;

});

const toSelectorExpression = (e: Element) => {

  const element = (tag: string, attrs?: Record<string, string>, text?: string) => {
    const elm = document.createElement(tag);
    if (attrs) for (const name in attrs) elm.setAttribute(name, attrs[name]);
    if (text != null) elm.textContent = text;
    return elm;
  };

  const container = element("code", { class: "selector" });
  const tagLabel = element("var", { class: "tag" });
  tagLabel.textContent = e.tagName.toLowerCase();
  container.append(tagLabel);

  if (!e.hasAttributes()) return container;

  const df = document.createDocumentFragment();
  Array.from(e.attributes).forEach(({ name, value }) => {
    df.append(
      element("code", undefined, "["),
      element("var", { class: "name" }, name),
      element("code", undefined, '="'),
      element("var", { class: "value" }, value),
      element("code", undefined, '"]')
    );
  });

  container.append(df);
  return container;

}

const NOTE_ID_SYMBOL = Symbol.for("blooky.note_id");
let autoNoteIdCounter = 0;

const resolveNoteId = (note: FxNote): string => {
  if (note.id && note.id.length) return note.id;
  const existing = (note as any)[NOTE_ID_SYMBOL];
  if (typeof existing === "string" && existing.length) return existing;
  const generated = `note-${autoNoteIdCounter++}`;
  (note as any)[NOTE_ID_SYMBOL] = generated;
  return generated;
};

// fx-switch: expose named slots in shadowRoot for visual inspection
if (EffectElementTagNameMap["fx-switch"]) {
  const Base = EffectElementTagNameMap["fx-switch"];
  EffectElementTagNameMap["fx-switch"] = class FxSwitchDevtools extends Base {
    connectedCallback(): void {
      super.connectedCallback?.();

      try {
        const shadow = this.shadowRoot;
        if (!shadow) return;

        // replace default slot with explicit named slots for each case label
        const existingSlot = shadow.querySelector("slot");
        existingSlot?.remove();

        const slots = [...this.children].filter((elm) => elm.slot != null).map((elm)=>{
          const s = document.createElement("slot");
          s.name = elm.slot;
          return s;
        });
        shadow.append(...slots);

        // ensure at least one slot exists
        if (!slots.length) shadow.append(document.createElement("slot"));
      } catch (e) {
        console.error("[devtools] fx-switch enhancement failed (isolated):", e);
      }
    }
  } as any;
}

// fx-effect: theme stylesheet (purely visual)
if (EffectElementTagNameMap["fx-effect"]) {
  const Base = EffectElementTagNameMap["fx-effect"] as any;
  EffectElementTagNameMap["fx-effect"] = class FxEffectDevtools extends Base {
    static observedAttributes = ["theme", ...(Base.observedAttributes ?? [])];

    private themeCSS?: CSSStyleSheet;

    private loadTheme(src: string) {
      try {
        if (!src || !this.shadowRoot) return;

        if (!this.themeCSS) {
          this.themeCSS = new CSSStyleSheet();
          this.shadowRoot.adoptedStyleSheets.push(this.themeCSS);
        }
        fetch(src)
          .then((r) => r.text())
          .then((t) => this.themeCSS!.replace(t))
          .catch((e) => console.warn("[devtools] theme fetch failed (isolated):", e));
      } catch (e) {
        console.warn("[devtools] theme load failed (isolated):", e);
      }
    }

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
      super.attributeChangedCallback?.(name, oldValue, newValue);
      if (name === "theme" && oldValue !== newValue) this.loadTheme(newValue);
    }

    connectedCallback(): void {
      super.connectedCallback?.();
      if (this.hasAttribute("theme")) this.loadTheme(this.getAttribute("theme")!);
    }
  } as any;
}


// ---------------------------------------------------------------------------
// Step → FxDOM CustomState projection
// ---------------------------------------------------------------------------

const setFxState = (el: HTMLElement, state: string, on: boolean) => {
  const st = FxElementStates.get(el);
  if (st) {
    if (on) st.add(state);
    else st.delete(state);
  } else {
    // attachInternals unavailable fallback（任意）
    if (on) el.classList.add(`is-${state}`);
    else el.classList.remove(`is-${state}`);
  }
};

const clearFxStates = (el: HTMLElement, states: string[]) => {
  for (const s of states) setFxState(el, s, false);
};

export const stepToFxState = (
  step: PerformanceStep,
  resolveElement: NoteElementResolver = () => undefined
) => {
  try {
    const el = resolveElement(step.note_id, step.execution_id);
    if (!el) return;

    // 状態語彙（必要最低限）
    // running: 実行中
    // paused : suspend 中（yield/wait）
    // completed/failed/cancelled/terminated: 終了状態
    switch (step.phase) {
      case "enter": {
        clearFxStates(el, ["completed", "failed", "cancelled", "terminated"]);
        setFxState(el, "running", false);
        setFxState(el, "paused", false);
        break;
      }
      case "active": {
        setFxState(el, "running", true);
        setFxState(el, "paused", false);
        break;
      }
      case "suspend": {
        // suspend は「境界で止まっている」
        setFxState(el, "running", false);
        setFxState(el, "paused", true);
        break;
      }
      case "resume": {
        setFxState(el, "paused", false);
        break;
      }
      case "exit": {
        // note と note の間（あなたの境界）で running を落とす
        setFxState(el, "running", false);
        setFxState(el, "paused", false);

        const terminated = !!(step.payload as any)?.terminated;
        const failed = !!(step.payload as any)?.failed; // もし runner が入れるなら
        // 現状の run() だと terminated は入っている。failed は入っていないので必要なら拡張。

        if (terminated) setFxState(el, "terminated", true);
        else if (failed) setFxState(el, "failed", true);
        else setFxState(el, "completed", true);

        break;
      }
      case "cancel": {
        setFxState(el, "running", false);
        setFxState(el, "paused", false);
        setFxState(el, "cancelled", true);
        break;
      }
      default:
        break;
    }

  } catch (error) {
    // MUST isolate
    console.error("[devtools] Step observer error (isolated):", error);
  }
};

export const executeByElement = (
  root: FxEffectElement,
  app: AppContext = {},
  ctx?: Partial<FxRuntime>
) => {
  const bindings = new Map<string, HTMLElement>();
  const collectBindings: NoteElementCollector = (noteId, element) => {
    const existing = bindings.get(noteId);
    if (existing && existing !== element) {
      // Duplicate explicit id means ambiguous projection target.
      console.warn("[devtools] Duplicate note_id for fx projection; keeping first binding:", noteId);
      return;
    }
    bindings.set(noteId, element);
  };

  const prevCollector = activeNoteElementCollector;
  activeNoteElementCollector = collectBindings;

  let handle;
  try {
    handle = defaultExecuteByElement(root, app, ctx);
  } finally {
    activeNoteElementCollector = prevCollector;
  }

  void handle.done.finally(() => {
    bindings.clear();
  });
  return handle;
};


// ---------------------------------------------------------------------------
// Optional: FRP graph monitoring helpers (Informative only)
// ---------------------------------------------------------------------------

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

  function visit(obj: Vertex | Prop<any>, label: string) {
    if (visited.has(obj)) return visited.get(obj)!;

    if (isChainedProp<any>(obj)) {
      const value = obj();
      const valueLabel =
        typeof value === "symbol" ? `symbol(${value.description || ""})` :
        typeof value === "string" ? `\\"${value.replace(/"/g, '\\"')}\\"` :
        String(value);

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
    if (props) edges.push(...props.map((p) => `${id} -> ${visit(p, names.get(p) || "none")}`));
    return id;
  }

  vertex_map.forEach(([name, streamOrProp]) => visit(streamOrProp, name));

  const digraph_attrs = Object.entries(graphAttrs).map((v) => v.join("=")).join(";\n");
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

export { fxdom, EffectElementTagNameMap };
