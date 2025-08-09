// blooky-dom-types.d.ts

import type { Prop } from "./blooky"; // Prop/Stream 型に合わせて

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
export type V_CLASSLIST = string[] | { [key: string]: boolean };
export type V_DATASET = { [key: string]: V_STRING };
export type V_STYLE = { [key in WritableCSSProperty]?: V_STRING | Prop<V_STRING> };
export type V_EVENTLISTENER = EventListenerOrEventListenerObject | GlobalEventHandlers[HTMLEventHandlers];

export type T_ATTRSET = 
    ["dataset", V_DATASET]|
    ["style", V_STYLE]|
    ["classList", V_CLASSLIST]|
    [`on${string}`, V_EVENTLISTENER]|
    [string, V_STRING];

// --- 属性セット型
export type JSHTMLAttrSource = V_STRING | V_CLASSLIST | V_DATASET | V_STYLE | V_EVENTLISTENER;


// --- 属性マップ型：補完あり＋カスタム属性許容
export type JSHTMLAttributeMapSource =
  Partial<
    {
      dataset: V_DATASET;
      style: V_STYLE;
      classList: V_CLASSLIST;
    } & {
      [key in HTMLAttrName]?: JSHTMLAttrSource;
    } & {
      [key in HTMLEventHandlers]?: V_EVENTLISTENER;
    }
  > & {
    [custom: string]: JSHTMLAttrSource;
  };

// --- ノード型（テキスト or ノード or フラグメント or Stream）
export type JSHTMLTextSource = V_STRING;
export type JSHTMLFragmentSource = JSHTMLNodeSource[];
export type JSHTMLNodeSource =
  | JSHTMLElementSource
  | JSHTMLTextSource
  | JSHTMLFragmentSource
  | Prop<JSHTMLElementSource | JSHTMLTextSource | JSHTMLFragmentSource>;

// --- 要素本体型（補完付きタグ名＋カスタム要素名OK）
export type JSHTMLElementSource = (
  {
    [K in keyof HTMLElementTagNameMap]?: JSHTMLNodeSource;
  } & {
    [customTag: string]: JSHTMLNodeSource | JSHTMLAttributeMapSource | undefined;
    $?: JSHTMLAttributeMapSource;
  }
);

// --- fxdom用タグ
export type FxTag = "call" | "delay" | "sequence" | "parallel" | "cancel" | "repeat" | "race" | "if";

// --- fxdom
export type JSHTMLEffectElementSource = {
  [K in FxTag]?: JSHTMLEffectElementSource | JSHTMLNodeSource | null;
} & { $?: JSHTMLAttributeMapSource };
