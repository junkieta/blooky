// blooky-dom-types.d.ts

import type { EmptyElementAttributeMapSource } from "./blooky-dom"; // この行を追加
import { Prop, DripperStream, DripEffect, BlookyError } from "./blooky-types";

// --- HTML属性名一覧
export type HTMLAttrName =
  | "abbr" | "accept" | "accept-charset" | "accesskey" | "action" | "allow" | "allowfullscreen" 
  | "allowpaymentrequest" | "alt" | "as" | "async" | "autocapitalize" | "autocomplete" 
  | "autofocus" | "autoplay" | "charset" | "checked" | "cite" | "class" | "color" 
  | "cols" | "colspan" | "content" | "contenteditable" | "controls" | "coords" 
  | "crossorigin" | "data" | "datetime" | "decoding" | "default" | "defer" 
  | "dir" | "dir" | "dirname" | "disabled" | "download" | "draggable" 
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
  | "style" | "tabindex" | "target" | "title" | "translate" | "type" | "usemap" | "value"
  | string; // fallback for custom attributes

// --- CSSのプロパティ名のうち、書き換え可能なものだけ
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

// --- HTMLイベントハンドラ名（補完付き）
export type HTMLEventHandlers = Extract<keyof GlobalEventHandlers, `on${string}`>;

// --- 値型バリアント
export type V_STRING = string | number | boolean | undefined | null;
export type V_CLASSLIST = string[] | Record<string,boolean>;
export type V_DATASET = Record<string,V_STRING|Prop<V_STRING>>;
export type V_STYLE = { [key in WritableCSSProperty]?: V_STRING | Prop<V_STRING> };
export type V_EVENTLISTENER = 
  DripperStream<any> |
  EventListenerOrEventListenerObject |
  GlobalEventHandlers[HTMLEventHandlers];

export type T_ATTRSET = 
    ["dataset", V_DATASET]|
    ["style", V_STYLE]|
    ["classList", V_CLASSLIST]|
    [`on${string}`, V_EVENTLISTENER|Prop<V_EVENTLISTENER>]|
    [string, V_STRING];

// --- 属性セット型
export type JSHTMLAttrSource = V_STRING | V_CLASSLIST | V_DATASET | V_STYLE | V_EVENTLISTENER;

// --- 属性マップ型：補完あり＋カスタム属性許容
export type JSHTMLAttributeMapSource =
  Partial<
    {
      dataset: V_DATASET
      style: V_STYLE
      classList: V_CLASSLIST
    } & {
      [key in HTMLEventHandlers]: V_EVENTLISTENER
    } & {
      [key in HTMLAttrName]: any//JSHTMLAttrSource;
    } 
  > & {
    [custom: string]: JSHTMLAttrSource;
  };

// --- ノード型（テキスト or ノード or フラグメント or Stream）
export type JSHTMLTextSource = V_STRING;
export type JSHTMLFragmentSource = JSHTMLNodeSource[];
export type JSHTMLPrimitiveSource = 
  | Node
  | JSHTMLTextSource
  | JSHTMLFragmentSource;

export type JSHTMLNodeSource =
  | JSHTMLPrimitiveSource
  | JSHTMLElementSource
  | Promise<JSHTMLNodeSource | Node>
  | Prop<Exclude<any,Prop<any>>>;

// --- 要素本体型（補完付きタグ名＋カスタム要素名OK）
export type JSHTMLElementSource = (
  {
    [K in keyof HTMLElementTagNameMap]?: JSHTMLNodeSource | EmptyElementAttributeMapSource
  } & {
    [customTag: string]: JSHTMLNodeSource | EmptyElementAttributeMapSource | JSHTMLAttributeMapSource | undefined 
    $?: JSHTMLAttributeMapSource
  }
);

export type JSHTMLExtractedElementSource = [tag: string, children: JSHTMLNodeSource, attrs?: JSHTMLAttributeMapSource];

export type JSHTMLNodeSourceType = 
    | "node"
    | "promise"
    | "prop"
    | "array"
    | "nullable"
    | "text"
    | "element"
;

export type JSHTMLNodeRuntime<T> = {
    build: (s:JSHTMLNodeSource) => Node
    source: T
    context?: Record<string,any>
}

export type JSHTMLAttrRuntime<T> = {
    name: string
    value: T
    target: HTMLElement
    context?: Record<string,any>
}

export type JSHTMLNodeSourceAnalyzer = {
  (s: JSHTMLNodeSource): JSHTMLNodeSourceType
}

export type JSHTMLNodeFactory = {
    "array": (runtime:JSHTMLNodeRuntime<JSHTMLNodeSource[]>) => DocumentFragment
    "nullable": (runtime:JSHTMLNodeRuntime<null|undefined>) => Comment
    "text": (runtime:JSHTMLNodeRuntime<any>) => Text
    "node": (runtime:JSHTMLNodeRuntime<Node>) => Node
    "prop": (runtime:JSHTMLNodeRuntime<Prop<JSHTMLNodeSource>>) => Node
    "promise": (runtime:JSHTMLNodeRuntime<Promise<JSHTMLNodeSource>>) => HTMLElement
    "element": (runtime:JSHTMLNodeRuntime<JSHTMLElementSource>) => HTMLElement
}

export type BlookyCollapseEvent<T extends "start"|"completed"|"failed"|"canceled"> = CustomEvent<DripEffect & {
  result: T extends "completed"
    ? number
    : T extends "failed"
    ? BlookyError<any>[]
    : undefined
}>
export type BlookyCollapseEventMap = {
  "blooky-collapse-start": BlookyCollapseEvent<"start">
  "blooky-collapse-completed": BlookyCollapseEvent<"completed">
  "blooky-collapse-failed": BlookyCollapseEvent<"failed">
  "blooky-collapse-canceled": BlookyCollapseEvent<"canceled">
}

export type BlookyAttrPropEventDetail<A> = { prop: Prop<A>, name: string, nextValue: A, prevValue: A }
export type BlookyPropEventMap = {
  "node-prop-update": CustomEvent<{ prop: Prop<JSHTMLNodeSource>, prevValue: JSHTMLNodeSource }>
  "attr-prop-update": CustomEvent<BlookyAttrPropEventDetail<JSHTMLAttrSource>>
  "style-prop-update": CustomEvent<BlookyAttrPropEventDetail<V_STYLE>>
  "dataset-prop-update": CustomEvent<BlookyAttrPropEventDetail<V_DATASET>>
}

export type BlookyMutationEvent = CustomEvent<{observer: MutationObserver, records: MutationRecord[]}>;
export type BlookyMutationEventMap = {
  "blooky-observe-mutations": BlookyMutationEvent
}



// --- fxdom用タグ
export type FxTag = "call" | "delay" | "sequence" | "parallel" | "cancel" | "repeat" | "race" | "if";

// --- fxdom
export type JSHTMLEffectElementSource = {
  [K in FxTag]?: JSHTMLEffectElementSource | JSHTMLAttributeMapSource | JSHTMLNodeSource | null;
} & { $?: JSHTMLAttributeMapSource };

