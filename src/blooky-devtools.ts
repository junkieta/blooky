import {
  fxdom,
  EffectElementTagNameMap as DefaultEffectElementTagNameMap,
  withLifecycleHooks,
  EffectElement,
  FxEffectElement,
  getElementForNote,
} from "./blooky-fxdom";
import { query, flattenFxNotes, resolveNoteId, observeRuntimeStep } from "./blooky-fx";
import type { AppContext, ExecutionConfig, FxNote, PerformanceStep } from "./blooky-fx-types";
import { clock } from "./runtime/clock";
import { decode } from "./blooky-context";
import { drip, isDripperStream, Prop } from "./blooky-fp";

// ---------------------------------------------------------------------------
// FxDOM projection state
// ---------------------------------------------------------------------------

const FxElementStates = new WeakMap<HTMLElement, CustomStateSet>();

export const getFxElement = (
  bindings: ReadonlyMap<string, HTMLElement>,
  noteId: string
): HTMLElement | undefined => bindings.get(noteId);
export const getFxElementStates = (el: HTMLElement): CustomStateSet | undefined => FxElementStates.get(el);

// ---- Stylesheets (dev-only visual aid) ----

const devtoolsCSSPath: string[] = []; // ["./blooky-devtools-nested.css", "./blooky-devtools-theme.css"];

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
      return new CSSStyleSheet();
    }
  })
).catch((e) => {
  console.warn("[devtools] Stylesheet loading failed (isolated):", e);
  return [];
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
};

// ---- Instrumentation: baseline (CustomStateSet + selector label) ----

const instrumentBase = (Base: typeof EffectElement) =>
  withLifecycleHooks(Base, {
    connected(el) {
      try {
        const internals = el.attachInternals();
        FxElementStates.set(el, internals.states);
      } catch (e) {
        console.warn("[devtools] attachInternals unavailable (isolated):", e);
      }

      const shadow = el.shadowRoot || el.attachShadow({ mode: "open" });

      DevEffectElementStyleSheets.then((sheets) => {
        try {
          const existing = new Set(shadow.adoptedStyleSheets);
          const next = sheets.filter((s) => !existing.has(s));
          if (next.length) shadow.adoptedStyleSheets.push(...next);
        } catch (e) {
          console.warn("[devtools] adoptedStyleSheets failed (isolated):", e);
        }
      });

      if (!shadow.querySelector(":scope > code.selector")) {
        shadow.insertBefore(toSelectorExpression(el), shadow.firstChild);
      }
      if (!shadow.querySelector("slot")) {
        shadow.append(document.createElement("slot"));
      }
    },
  });

const EffectElementTagNameMap: typeof DefaultEffectElementTagNameMap = Object.fromEntries(
  Object.entries(DefaultEffectElementTagNameMap).map(([tag, cls]) => [tag, instrumentBase(cls)])
) as any;

// ---- Instrumentation: fx-switch named-slot exposure ----

if (EffectElementTagNameMap["fx-switch"]) {
  EffectElementTagNameMap["fx-switch"] = withLifecycleHooks(EffectElementTagNameMap["fx-switch"], {
    connected(el) {
      try {
        const shadow = el.shadowRoot;
        if (!shadow) return;

        const existingSlot = shadow.querySelector("slot");
        existingSlot?.remove();

        const slots = [...el.children]
          .filter((elm) => elm.slot != null)
          .map((elm) => {
            const s = document.createElement("slot");
            s.name = elm.slot;
            return s;
          });
        shadow.append(...slots);

        if (!slots.length) shadow.append(document.createElement("slot"));
      } catch (e) {
        console.error("[devtools] fx-switch enhancement failed (isolated):", e);
      }
    },
  });
}

// ---- Instrumentation: fx-effect theme stylesheet ----

if (EffectElementTagNameMap["fx-effect"]) {
  const themeSheets = new WeakMap<HTMLElement, CSSStyleSheet>();

  const loadTheme = (el: HTMLElement, src: string) => {
    try {
      if (!src || !el.shadowRoot) return;
      let sheet = themeSheets.get(el);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        themeSheets.set(el, sheet);
        el.shadowRoot.adoptedStyleSheets.push(sheet);
      }
      fetch(src)
        .then((r) => r.text())
        .then((t) => sheet!.replace(t))
        .catch((e) => console.warn("[devtools] theme fetch failed (isolated):", e));
    } catch (e) {
      console.warn("[devtools] theme load failed (isolated):", e);
    }
  };

  EffectElementTagNameMap["fx-effect"] = withLifecycleHooks(EffectElementTagNameMap["fx-effect"], {
    observedAttributes: ["theme"],
    connected(el) {
      if (el.hasAttribute("theme")) loadTheme(el, el.getAttribute("theme")!);
    },
    attributeChanged(el, name, oldValue, newValue) {
      if (name === "theme" && oldValue !== newValue) loadTheme(el, newValue!);
    },
  });
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
    if (on) el.classList.add(`is-${state}`);
    else el.classList.remove(`is-${state}`);
  }
};

const clearFxStates = (el: HTMLElement, states: string[]) => {
  for (const s of states) setFxState(el, s, false);
};

const isFxRefKeyLike = (v: unknown): v is { key: string } =>
  !!v && typeof v === "object" && typeof (v as any).key === "string";

const resolveDoneProp = (note: FxNote, app: AppContext): Prop<any> | null => {
  const done = (note as any).done;
  if (done === undefined || done === null) return null;

  let resolved: unknown = done;
  if (isFxRefKeyLike(done)) {
    const key = done.key;
    if (key.startsWith("#") || key.startsWith("$_")) return null;
    try {
      resolved = decode(app as any, { kind: "ctx", key });
    } catch {
      return null;
    }
  }

  if (!isDripperStream(resolved)) return null;
  const plan = drip([resolved,undefined]);
  return (plan[0]?.[0] as Prop<any> | undefined) ?? null;
};

const tickToFxState = (
  tick: { effects_summary: Map<Prop<any>, unknown> },
  propBindings: ReadonlyMap<Prop<any>, Set<HTMLElement>>
) => {
  try {
    tick.effects_summary.forEach((_value, prop) => {
      const targets = propBindings.get(prop);
      if (!targets) return;
      targets.forEach((el) => {
        clearFxStates(el, ["running", "paused", "failed", "cancelled", "terminated"]);
        setFxState(el, "completed", true);
      });
    });
  } catch (error) {
    console.error("[devtools] Tick observer error (isolated):", error);
  }
};

type NoteElementResolver = (noteId: string, executionId: string) => HTMLElement | undefined;

export const stepToFxState = (
  step: PerformanceStep,
  resolveElement: NoteElementResolver = () => undefined
) => {
  try {
    const el = resolveElement(step.note_id, step.execution_id);
    if (!el) return;

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
        if(el.tagName.toLowerCase() === "fx-loop") {
          [...el.getElementsByTagName("*")].forEach((e)=>{
            clearFxStates(e as HTMLElement, ["running","paused","completed","failed","cancelled","terminated"]);
          })
        }
        break;
      }
      case "suspend": {
        setFxState(el, "running", false);
        setFxState(el, "paused", true);
        break;
      }
      case "resume": {
        setFxState(el, "paused", false);
        break;
      }
      case "exit": {
        setFxState(el, "running", false);
        setFxState(el, "paused", false);

        const terminated = !!(step.payload as any)?.terminated;
        const failed = !!(step.payload as any)?.failed;

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
    console.error("[devtools] Step observer error (isolated):", error);
  }
};

// ---------------------------------------------------------------------------
// Execution bridge
//
// note↔element の対応は fxdom 内部の noteElementMap（非公開）が toFxNote()
// 呼び出し時に自動記録する。devtools はそれを getElementForNote() 経由で
// 読むだけで、fxdom の実装(クラス階層・呼び出しタイミング)を一切知らない。
// note木の走査には blooky-fx が公開する flattenFxNotes() を使い、
// runtime/engine.ts には一切依存しない。
// ---------------------------------------------------------------------------

export const executeByElement = (
  root: FxEffectElement,
  app: AppContext = {},
  ctx?: Partial<ExecutionConfig>
) => {
  if (root.tagName.toLowerCase() !== "fx-effect")
    throw new Error("[ExecuteError] executeByElement needs `fx-effect` Element");
  if (!root.isConnected)
    throw new Error("[ExecuteError] Element is not connected");

  const note = root.toFxNote();

  const bindings = new Map<string, HTMLElement>();
  const propBindings = new Map<Prop<any>, Set<HTMLElement>>();

  flattenFxNotes(note).forEach((n) => {
    const element = getElementForNote(n);
    if (!element) return;

    const noteId = resolveNoteId(n);
    const existing = bindings.get(noteId);
    if (existing && existing !== element) {
      console.warn("[devtools] Duplicate note_id for fx projection; keeping first binding:", noteId);
      return;
    }
    bindings.set(noteId, element);

    const doneProp = resolveDoneProp(n, app);
    if (doneProp) {
      if (!propBindings.has(doneProp)) propBindings.set(doneProp, new Set());
      propBindings.get(doneProp)!.add(element);
    }
  });

  const executionScope = new Set<string>();
  const handle = query(note, app, ctx);

  const unobserveTick = clock.observeTick((tick) => {
    tickToFxState(tick, propBindings);
  });
  const unobserveStep = observeRuntimeStep((step) => {
    if (!executionScope.has(step.execution_id)) {
      if (!bindings.has(step.note_id)) return;
      executionScope.add(step.execution_id);
    }
    stepToFxState(step, (noteId) => getFxElement(bindings, noteId));
  });

  void handle.done.finally(() => {
    unobserveStep();
    unobserveTick();
    executionScope.clear();
    bindings.clear();
    propBindings.clear();
  });
  return handle;
};

// ---------------------------------------------------------------------------
// FRP graph monitoring — 別モジュールへ委譲するのみ。
// demo.ts 等の既存importを壊さないための再export。
// ---------------------------------------------------------------------------

export { dumpGraphDOT, dripGraph } from "./blooky-fp-graphviz";

export { fxdom, EffectElementTagNameMap };