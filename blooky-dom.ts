/**
 * blooky-dom.ts
 * blooky-domを用いてリアクティブなDOMを構築するライブラリ。
 * 簡易な仕様でDOMを構築しつつ、Streamを利用した更新管理も行う。
 */
import { Stream, isStream, listen, Prop, stream, drip } from "./blooky";

export type HTMLAttrName =
    "abbr" | "accept" | "accept-charset" | "accesskey" | "action" | "allow" | "allowfullscreen" | "allowpaymentrequest" | "alt" | "as" | "async" | "autocapitalize" | "autocomplete" | "autofocus" | "autoplay" | "charset" | "checked" | "cite" | "class" | "color" | "cols" | "colspan" | "content" | "contenteditable" | "controls" | "coords" | "crossorigin" | "data" | "datetime" | "decoding" | "default" | "defer" | "dir" | "dir" | "dirname" | "disabled" | "download" | "draggable" | "enctype" | "enterkeyhint" | "for" | "form" | "formaction" | "formenctype" | "formmethod" | "formnovalidate" | "formtarget" | "headers" | "height" | "hidden" | "high" | "href" | "hreflang" | "http-equiv" | "id" | "imagesizes" | "imagesrcset" | "inputmode" | "integrity" | "is" | "ismap" | "itemid" | "itemprop" | "itemref" | "itemscope" | "itemtype" | "kind" | "label" | "lang" | "list" | "loop" | "low" | "manifest" | "max" | "maxlength" | "media" | "method" | "min" | "minlength" | "multiple" | "muted" | "name" | "nomodule" | "nonce" | "novalidate" | "open" | "optimum" | "pattern" | "ping" | "placeholder" | "playsinline" | "poster" | "preload" | "readonly" | "referrerpolicy" | "rel" | "required" | "reversed" | "rows" | "rowspan" | "sandbox" | "scope" | "selected" | "shape" | "size" | "sizes" | "slot" | "span" | "spellcheck" | "src" | "srcdoc" | "srclang" | "srcset" | "start" | "step" | "style" | "tabindex" | "target" | "title" | "translate" | "type" | "usemap" | "value";

export type WritableCSSProperty = Exclude<keyof CSSStyleDeclaration,
    "getPropertyPriority"|
    "getPropertyValue"|
    "item"|
    "removeProperty"|
    "setProperty"|
    "length"|
    "parentRule"|
    number|
    symbol
>;

type HTMLTag = keyof HTMLElementTagNameMap;
type HTMLEventHandlers = Extract<keyof GlobalEventHandlers,`on${string}`>;

type V_STRING = string | number | boolean | undefined | null;
type V_CLASSLIST = string[]|{[key:string]:boolean};
type V_DATASET = {[key:string]:V_STRING};
type V_STYLE = { [key in WritableCSSProperty]?: V_STRING|Stream<V_STRING> };
type V_EVENTLISTENER = EventListenerOrEventListenerObject|GlobalEventHandlers[HTMLEventHandlers];
type T_ATTRSET = 
    ["dataset", V_DATASET]|
    ["style", V_STYLE]|
    ["classList", V_CLASSLIST]|
    [`on${string}`, V_EVENTLISTENER]|
    [string, V_STRING];



type JSHTMLFragmentSource = JSHTMLNodeSource[];
type JSHTMLTextSource = V_STRING;
type JSHTMLNodeSource = JSHTMLElementSource<string> | JSHTMLTextSource | JSHTMLFragmentSource;
type JSHTMLAttrSource = 
    T_ATTRSET[1];

type JSHTMLAttributeMapSource =
    Partial<
        { dataset: V_DATASET, style: V_STYLE, classList: V_CLASSLIST } &
        { [key in HTMLAttrName]: JSHTMLAttrSource } & 
        { [key in HTMLEventHandlers]: GlobalEventHandlers[key] }
    >;
type JSHTMLElementSource<T extends string> = 
    { [key in T]: T extends "$" ? JSHTMLAttributeMapSource : JSHTMLNodeSource };

/**
 * tag指定がjshtmlの仕様に沿わなかった場合に生成される要素の定義。
 */
class JSHTMLUnknownElement extends HTMLElement {}
customElements.define("jshtml-unknown", JSHTMLUnknownElement);


/**
 * class属性の設定用関数を生成する
 * @param v 
 * @returns 
 */
const gen_className_setter = (v:V_CLASSLIST|V_STRING) :(e:Element)=>void => 
    v == null
    ? (e:Element) => e.removeAttribute("class")
    : Array.isArray(v)
    ? (e:Element) => e.className = v.filter(Boolean).join(" ")
    : (e:Element) => e.className = typeof v === "object"
        ? Object.keys(v).filter((k)=>v[k]).join(" ")
        : v + "";

/**
 * datasetの設定用関数を生成する
 * @param v 
 * @returns 
 */
const gen_dataset_setter =
    (v:V_DATASET|null) =>
        v == null
        ? (e:HTMLElement) => Object.keys(e.dataset).forEach((k)=> delete e.dataset[k])
        : (e:HTMLElement) => Object.entries(v).forEach(([k,v]) => e.dataset[k] = v != null ? v + "" : '');

/**
 * インラインスタイルの設定用関数を生成する
 * @param v 
 * @returns 
 */
const gen_style_setter =
    (v:V_STYLE) =>
        v == null
        ? (e:HTMLElement) => e.removeAttribute("style")
        : (e:HTMLElement) => 
            (Object.entries(v) as [WritableCSSProperty,V_STRING][]).forEach(([k,v]) => {
                if(isStream<V_STYLE>(v)) {
                    bind_style_stream(v)([e,k]);
                } else {
                    e.style[k as any] = v != null ? v + '' : ''
                }
            })


/**
 * イベントリスナーの設定用関数を生成する
 * @param v 
 * @param n 
 * @returns 
 */
const gen_listener_setter =
    (v:V_EVENTLISTENER, n: string) => 
        v && (typeof v === "function" || typeof v.handleEvent === "function")
        ? (e:EventTarget) => e.addEventListener(n.slice(2), v as EventListener)
        : (e:Element) => e.setAttribute(n,v+"");

/**
 * 仕様に沿った要素を生成する
 * @param s 
 * @returns 
 */
const element = <T extends string>(s:JSHTMLElementSource<T|"$">) => {
    const [tag,children,attrs] = extractElementSource<T>(s);
    const elm = document.createElement(tag);
    if(children)
        elm.append(jshtml(children));
    if(attrs)
        Object.entries(attrs).forEach(([k,v])=> {
            if(isStream<JSHTMLAttrSource>(v))
                bind_attr_stream(v)([elm,k]);
            else
                update_attr(elm)([k,v] as T_ATTRSET);
        })
    return elm as T extends HTMLTag ? HTMLElementTagNameMap[T] : HTMLElement;
}

/**
 * JSHTMLElementSourceを部品に分割して返す
 * @param s 
 * @returns 
 */
const extractElementSource = <T extends string>(s:JSHTMLElementSource<T>) : [T,JSHTMLNodeSource,JSHTMLAttributeMapSource?] => {
    const k = Object.keys(s).filter((t)=>t !== "$");
    if(!k.length) {
        console.error("invalid tag name err: returned 'jshtml-unknown' tag");
        return ["jshtml-unknown" as T, null];
    }
    const tag = k[0] as T;
    const children = s[tag] as JSHTMLNodeSource;
    const attrs = "$" in s ? (s.$ as JSHTMLAttributeMapSource) : undefined;
    return [tag,children,attrs];
}

/**
 * ノードとストリームのバインディングを行う。
 * @param s 
 * @returns 
 */
const bind_node_stream = (s:Stream<JSHTMLNodeSource>) => function f(p:[Node,Node]) {
    const unlisten = listen(s)((v) => {
        if(p.every((n)=>n.isConnected))
            f(update_range(p)(v));
        unlisten();
    });
}

/**
 * 属性とストリームのバインディングを行う
 * @param s 
 * @returns 
 */
const bind_attr_stream = (s:Stream<JSHTMLAttrSource>) => function f([e,n]:[HTMLElement,string]) {
    const unlisten = listen(s)((v) => {
        if(e.isConnected) {
            update_attr(e)([n,v] as T_ATTRSET);
            f([e,n]);
        }
        unlisten();
    });
}

/**
 * スタイル属性値とストリームをバインディングする
 * @param s 
 * @returns 
 */
const bind_style_stream = (s:Stream<V_STYLE>) => ([e,p]:[HTMLElement, WritableCSSProperty]) => {
    const unlisten = listen(s)((v) => {
        if(e.isConnected) {
            e.style[p] = v + "";
            unlisten();
        }
    });
}

/**
 * DOM範囲の更新を行う
 * @param param0 
 * @returns 
 */
const update_range = ([a,b]:[Node,Node]) => (v:JSHTMLNodeSource) : [Node,Node] => {
    const n = jshtml(v);
    const [_a,_b] = n.nodeType === n.DOCUMENT_FRAGMENT_NODE
        ? [n.firstChild!, n.lastChild!]
        : [n,n];
    const r = new Range();
    r.setStartBefore(a);
    r.setEndAfter(b);
    r.insertNode(n);
    r.setStartAfter(_b);
    r.deleteContents();
    return [_a,_b];
};

/**
 * HTML要素の属性値を更新する
 * @param e 
 * @returns 
 */
const update_attr = (e:HTMLElement) => ([n,v]:T_ATTRSET) => {
    if(v == null)
        e.removeAttribute(n);
    else if(!(v instanceof Object))
        e.setAttribute(n, v + "");
    else if(n === "classList")
        gen_className_setter(v)(e);
    else if(n === "dataset")
        gen_dataset_setter(v)(e);
    else if(n === "style")
        gen_style_setter(v)(e);
    else if(/^on+/.test(n))
        gen_listener_setter(v as V_EVENTLISTENER, n)(e);
    else
        throw new Error("unknown attribute's value")
};


/**
 * jshtml仕様に沿ったDOMを生成して返し、ストリーム値は生成結果DOMにバインディングする。
 * @param s 
 * @returns 
 */
function jshtml<T extends string>(s:JSHTMLElementSource<T|"$">): T extends HTMLTag ? HTMLElementTagNameMap[T] : HTMLElement;
function jshtml<V>(s:Prop<V>): ReturnType<typeof jshtml>;
function jshtml<V>(s:Stream<V>): Comment;
function jshtml(s:JSHTMLTextSource): Text;
function jshtml(s:JSHTMLFragmentSource): DocumentFragment;
function jshtml<T extends string>(s:JSHTMLNodeSource|Prop<JSHTMLNodeSource>|Stream<JSHTMLNodeSource>): T extends HTMLTag ? HTMLElementTagNameMap[T] : HTMLElement | DocumentFragment | Text | Comment;
function jshtml<T extends string>(s:JSHTMLNodeSource|Prop<JSHTMLNodeSource>|Stream<JSHTMLNodeSource>) {
    if(typeof s === "function")
        return jshtml<T>(s());
    if(Array.isArray(s)) {
        const df = document.createDocumentFragment();
        df.append(...s.map(jshtml));
        return df;
    }
    if(s != null && typeof s === "object") {
        if(!isStream<JSHTMLNodeSource>(s)) return element(s);
        const n = new Comment("[jshtml::placeholder]");
        bind_node_stream(s)([n,n])
        return n;
    }
    return new Text(s+"");
}

/**
 * MutationObserverを介して、DOMの変異をイベントストリームに接続する。
 * @param n 
 * @returns 
 */
const mutations = (n: Node) => (init: MutationObserverInit) : [Stream<MutationRecord[]>,()=>void] => {
    const s = stream<MutationRecord[],MutationRecord[]>();
    const o = new MutationObserver(drip(s));
    o.observe(n, init);
    return [s, o.disconnect.bind(o)];
};

/**
 * addEventListenerを介して、DOMイベントをイベントストリームに接続する。
 * @param target 
 * @returns 
 */
const events = (target:EventTarget) => <T extends string, E = T extends keyof HTMLElementEventMap ? HTMLElementEventMap[T] : Event>(t: T) : [Stream<E>,()=>void] => {
    const s = stream<E,Event>();
    const l = drip(s);
    target.addEventListener(t, l, false);
    return [s, target.removeEventListener.bind(target,t,l,false)];
}

export {jshtml, mutations, events};
