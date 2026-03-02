// blooky-fv-types.d.ts

import type { EmptyElementAttributeMapSource } from "./blooky-fv";
import type { Prop, DripperStream, DripPlan } from "./blooky-fp-types";

// ------------------------------------------------------------
// 0) HTML attribute name list (for completion)
// ------------------------------------------------------------

export type HTMLAttrName =
  | "abbr" | "accept" | "accept-charset" | "accesskey" | "action" | "allow" | "allowfullscreen"
  | "allowpaymentrequest" | "alt" | "as" | "async" | "autocapitalize" | "autocomplete"
  | "autofocus" | "autoplay" | "charset" | "checked" | "cite" | "class" | "color"
  | "cols" | "colspan" | "content" | "contenteditable" | "controls" | "coords"
  | "crossorigin" | "data" | "datetime" | "decoding" | "default" | "defer"
  | "dir" | "dirname" | "disabled" | "download" | "draggable"
  | "enctype" | "enterkeyhint" | "for" | "form" | "formaction"
  | "formenctype" | "formmethod" | "formnovalidate" | "formtarget"
  | "headers" | "height" | "hidden" | "high" | "href" | "hreflang"
  | "http-equiv" | "id" | "imagesizes" | "imagesrcset" | "inputmode" | "integrity" | "is"
  | "ismap" | "itemid" | "itemprop" | "itemref" | "itemscope" | "itemtype" | "kind" | "label"
  | "lang" | "list" | "loop" | "low" | "manifest" | "max" | "maxlength" | "media" | "method"
  | "min" | "minlength" | "multiple" | "muted" | "name" | "nomodule" | "nonce" | "novalidate"
  | "open" | "optimum" | "pattern" | "ping" | "placeholder" | "playsinline" | "poster"
  | "preload" | "readonly" | "referrerpolicy" | "rel" | "required" | "reversed" | "rows"
  | "rowspan" | "sandbox" | "scope" | "selected" | "shape" | "size" | "sizes" | "slot"
  | "span" | "spellcheck" | "src" | "srcdoc" | "srclang" | "srcset" | "start" | "step"
  | "style" | "tabindex" | "target" | "title" | "translate" | "type" | "usemap" | "value";

// ------------------------------------------------------------
// 1) CSS property helpers
// ------------------------------------------------------------

export type WritableCSSProperty = Exclude<
  keyof CSSStyleDeclaration,
  | "getPropertyPriority"
  | "getPropertyValue"
  | "item"
  | "removeProperty"
  | "setProperty"
  | "length"
  | "parentRule"
  | number
  | symbol
>;

// ------------------------------------------------------------
// 2) Event handler names (completion)
// ------------------------------------------------------------

export type HTMLEventHandlers = Extract<keyof GlobalEventHandlers, `on${string}`>;

// ------------------------------------------------------------
// 3) Value variants
// ------------------------------------------------------------

export type V_STRING = string | number | boolean | undefined | null;

export type V_CLASSLIST = string[] | Record<string, boolean>;

export type V_DATASET = Record<string, V_STRING | Prop<V_STRING>>;

export type V_STYLE = { [key in WritableCSSProperty]?: V_STRING | Prop<V_STRING> };

export type V_EVENTLISTENER =
  | DripperStream<any>
  | EventListenerOrEventListenerObject
  | GlobalEventHandlers[HTMLEventHandlers];

// ------------------------------------------------------------
// 4) Attribute sources
// ------------------------------------------------------------

// fv 実装が isChainedProp(value) を扱う以上、型でも Prop を許可しておく。
export type JSHTMLAttrSource =
  | V_STRING
  | V_CLASSLIST
  | V_DATASET
  | V_STYLE
  | V_EVENTLISTENER
  | JSHTMLPropSource;

// “補完させたい既知キー” を closed set として分離
type KnownJSHTMLAttrs =
  & {
    dataset?: V_DATASET;
    style?: V_STYLE;
    classList?: V_CLASSLIST;
  }
  & {
    [K in HTMLEventHandlers]?: V_EVENTLISTENER | Prop<V_EVENTLISTENER>;
  }
  & {
    [K in HTMLAttrName]?: JSHTMLAttrSource;
  };

// 既知キーは補完、未知キーは index signature で受ける（any は避ける）
export type JSHTMLAttributeMapSource =
  KnownJSHTMLAttrs
  & {
    [custom: string]: JSHTMLAttrSource;
  };

// ------------------------------------------------------------
// 5) Node sources
// ------------------------------------------------------------

export type JSHTMLTextSource = V_STRING;

export type JSHTMLFragmentSource = JSHTMLNodeSource[];

export type JSHTMLPrimitiveSource =
  | Node
  | JSHTMLTextSource
  | JSHTMLFragmentSource;

export type JSHTMLPropSource = ()=>any;

// 注意：実装の analyzeNodeSource は Prop を “function” として見ている。
// ここでは Prop の戻り値型を JSHTMLNodeSource に寄せておく（型安全寄り）。
export type JSHTMLNodeSource =
  | JSHTMLPrimitiveSource
  | JSHTMLElementSource
  | Promise<JSHTMLNodeSource | Node>
  | JSHTMLPropSource;



// ------------------------------------------------------------
// 6) Element sources
// ------------------------------------------------------------

// jshtml 実装は extractElementSource で次を許容している：
// - { tag: children, $: attrs }
// - { tag: EmptyElementAttributeMapSource(attrs) } （空要素属性を子位置に置く）
export type JSHTMLElementSource =
  & ({
    [K in keyof HTMLElementTagNameMap]?: JSHTMLNodeSource | EmptyElementAttributeMapSource;
  })
  & {
    [customTag: string]:
      | JSHTMLNodeSource
      | EmptyElementAttributeMapSource
      | JSHTMLAttributeMapSource
      | undefined;
    $?: JSHTMLAttributeMapSource;
  };

// extractElementSource の実装は children を null にしうる（attrs-only / empty element）
export type JSHTMLExtractedElementSource = [
  tag: string,
  children: JSHTMLNodeSource | null,
  attrs?: JSHTMLAttributeMapSource
];

// ------------------------------------------------------------
// 7) Analyzer & runtime shapes
// ------------------------------------------------------------

export type JSHTMLNodeSourceType =
  | "node"
  | "promise"
  | "prop"
  | "array"
  | "nullable"
  | "text"
  | "element";

export type JSHTMLAttrSourceType =
  | "nullable"
  | "listener"
  | "style"
  | "dataset"
  | "classList"
  | "toggle"
  | "string";

export type JSHTMLNodeRuntime<T> = {
  build: (s: JSHTMLNodeSource) => Node;
  source: T;
  context?: Record<string, any>;
};

export type JSHTMLAttrRuntime<T> = {
  name: string;
  value: T;
  target: HTMLElement;
  context?: Record<string, any>;
};

export type JSHTMLNodeSourceAnalyzer = (s: JSHTMLNodeSource) => JSHTMLNodeSourceType;

export type JSHTMLAttrAnalyzer = (k: string, s: JSHTMLAttrSource) => JSHTMLAttrSourceType;

// ------------------------------------------------------------
// 8) Factories / Builders
// ------------------------------------------------------------

export type JSHTMLNodeFactory = {
  array: (runtime: JSHTMLNodeRuntime<JSHTMLNodeSource[]>) => DocumentFragment;
  nullable: (runtime: JSHTMLNodeRuntime<null | undefined>) => Comment;
  text: (runtime: JSHTMLNodeRuntime<any>) => Text;
  node: (runtime: JSHTMLNodeRuntime<Node>) => Node;
  prop: (runtime: JSHTMLNodeRuntime<JSHTMLPropSource>) => Node;
  // 実装は PromisedElement extends HTMLElement を返す
  promise: (runtime: JSHTMLNodeRuntime<Promise<JSHTMLNodeSource | Node>>) => HTMLElement;
  element: (runtime: JSHTMLNodeRuntime<JSHTMLElementSource>) => HTMLElement;
};

export type JSHTMLAttrBuilder = {
  nullable: (runtime: JSHTMLAttrRuntime<null | undefined>) => void;
  listener: (runtime: JSHTMLAttrRuntime<V_EVENTLISTENER>) => void;
  style: (runtime: JSHTMLAttrRuntime<V_STYLE>) => void;
  dataset: (runtime: JSHTMLAttrRuntime<V_DATASET>) => void;
  classList: (runtime: JSHTMLAttrRuntime<V_CLASSLIST>) => void;
  toggle: (runtime: JSHTMLAttrRuntime<boolean>) => void;
  string: (runtime: JSHTMLAttrRuntime<string>) => void;
};

// ------------------------------------------------------------
// 9) DOM Events (informative types)
// ------------------------------------------------------------

export type BlookyCommitEvent<T extends "start" | "completed" | "failed" | "canceled"> =
  CustomEvent<
    { plan: DripPlan<any> } & (
      T extends "completed" ? { resolve: unknown } :
      T extends "failed" ? { reject: unknown } :
      {}
    )
  >;

export type BlookyCommitEventMap = {
  "blooky-commit-start": BlookyCommitEvent<"start">;
  "blooky-commit-completed": BlookyCommitEvent<"completed">;
  "blooky-commit-failed": BlookyCommitEvent<"failed">;
  "blooky-commit-canceled": BlookyCommitEvent<"canceled">;
};

export type BlookyAttrPropEventDetail<A> = {
  prop: Prop<A>;
  name: string;
  nextValue: A;
  prevValue: A;
};

export type BlookyPropEventMap = {
  "node-prop-update": CustomEvent<{
    prop: Prop<JSHTMLNodeSource>;
    nextValue?: unknown; // 実装は target(range anchor pair) を入れているが型は過度に縛らない
    prevValue: JSHTMLNodeSource;
  }>;
  "attr-prop-update": CustomEvent<BlookyAttrPropEventDetail<JSHTMLAttrSource>>;
  "style-prop-update": CustomEvent<BlookyAttrPropEventDetail<V_STRING>>;
  "dataset-prop-update": CustomEvent<BlookyAttrPropEventDetail<V_STRING>>;
};

/*
// ------------------------------------------------------------
// fxdom (deferred / commented out)
// ------------------------------------------------------------

// --- fxdom 用タグ
export type FxTag = "call" | "delay" | "sequence" | "parallel" | "cancel" | "repeat" | "race" | "if";

// --- fxdom
export type JSHTMLEffectElementSource = {
  [K in FxTag]?: JSHTMLEffectElementSource | JSHTMLAttributeMapSource | JSHTMLNodeSource | null;
} & { $?: JSHTMLAttributeMapSource };

// export type FxExecutionEventMap = {
//   "fx-step": CustomEvent<ExecutionStep>
//   "fx-execution-start": CustomEvent<{ executionId: string }>
//   "fx-execution-complete": CustomEvent<{ executionId: string, context: AppContext }>
//   "fx-execution-error": CustomEvent<{ executionId: string, error: Error }>
// }
*/
