/**
 * blooky-dom.ts
 * blooky-domを用いてリアクティブなDOMを構築するライブラリ。
 * 簡易な仕様でDOMを構築しつつ、Streamを利用した更新管理も行う。
 */
import type { V_DATASET, V_STYLE, V_CLASSLIST, V_EVENTLISTENER, V_STRING, WritableCSSProperty, JSHTMLElementSource, JSHTMLAttrSource, JSHTMLNodeSource, JSHTMLAttributeMapSource } from "./blooky-dom-types";
import { Stream, listen, Prop, stream, drip } from "./blooky";

type T_ATTRSET = 
    ["dataset", V_DATASET]|
    ["style", V_STYLE]|
    ["classList", V_CLASSLIST]|
    [`on${string}`, V_EVENTLISTENER]|
    [string, V_STRING];

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
            (Object.entries(v) as [WritableCSSProperty,V_STRING|Prop<V_STRING>][]).forEach(([k,v]) => {
                let _v = v;
                if(typeof v === "function") {
                    bind_style_stream(v)([e,k]);
                     _v = v();
                }
                e.style[k as any] = _v != null ? v + '' : ''
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
const element = (s:JSHTMLElementSource) => {
    const [tag,children,attrs] = extractElementSource(s);
    const elm = document.createElement(tag);
    if(children)
        elm.append(jshtml(children));
    if(attrs)
        Object.entries(attrs).forEach(([k,v])=> {
            if(typeof v !== "function")
                update_attr(elm)([k,v] as T_ATTRSET);
            else if(/^on.+/.test(k))
                gen_listener_setter(v as V_EVENTLISTENER, k)(elm);
            else 
                bind_attr_stream(v as Prop<JSHTMLAttrSource>)([elm,k]);
        })
    return elm;
}

/**
 * JSHTMLElementSourceを部品に分割して返す
 * @param s 
 * @returns 
 */
const extractElementSource = (s:JSHTMLElementSource) : [string,JSHTMLNodeSource,JSHTMLAttributeMapSource?] => {
    const tag = Object.keys(s).find((t)=>t !== "$");
    if(!tag) {
        console.error("invalid tag name err: returned 'jshtml-unknown' tag");
        return ["jshtml-unknown", null];
    }
    const children = s[tag] as JSHTMLNodeSource;
    const attrs = "$" in s ? (s.$ as JSHTMLAttributeMapSource) : undefined;
    return [tag,children,attrs];
}

/**
 * ノードとストリームのバインディングを行う。
 * @param s 
 * @returns 
 */
const bind_node_stream = <T extends JSHTMLNodeSource>(s:Stream<T>|Prop<T>) => function f(p:[Node,Node]) {
    const unlisten = listen(s)((v) => {
        if(p.every((n)=>n.isConnected))
            f(update_range(p)(v));
        else
            unlisten();
    });
}

/**
 * 属性とストリームのバインディングを行う
 * @param s 
 * @returns 
 */
const bind_attr_stream = (p:Prop<JSHTMLAttrSource>) => ([e,n]:[HTMLElement,string]) => {
    const unlisten = listen(p)((v) => {
        if(e.isConnected) {
            update_attr(e)([n,v] as T_ATTRSET);
        } else {
            unlisten();
        }
    });
}

/**
 * スタイル属性値とストリームをバインディングする
 * @param s 
 * @returns 
 */
const bind_style_stream = (s:Prop<V_STRING>) => ([e,p]:[HTMLElement, WritableCSSProperty]) => {
    const unlisten = listen(s)((v) => {
        if(e.isConnected) {
            e.style[p] = v + "";
        } else {
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
    else if(typeof v === "boolean")
        e.toggleAttribute(n, v);
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
    else {
        console.log(n,v);
        throw new Error("unknown attribute's value")
    }
};


/**
 * jshtml仕様に沿ったDOMを生成して返し、ストリーム値は生成結果DOMにバインディングする。
 * @param s 
 * @returns 
 */
function jshtml(s:JSHTMLNodeSource|Prop<JSHTMLNodeSource>): Node {
    if(typeof s === "function") {
        const n = jshtml(s());
        if(n.nodeType !== n.DOCUMENT_FRAGMENT_NODE) {
            bind_node_stream(s)([n,n]);
        }
        else if(n.hasChildNodes()) {
            bind_node_stream(s)([n.firstChild!,n.lastChild!]);
        }
        else {
            const _n = new Comment("[jshtml::placeholder]");
            bind_node_stream(s)([_n,_n]);
            return _n;
        }
        return n;
    }
    if(Array.isArray(s)) {
        const df = document.createDocumentFragment();
        df.append(...s.map(jshtml));
        return df;
    }
    if(s == null || s == undefined) {
        return new Comment("[jshtml::null]");
    }
    if(typeof s !== "object") {
        return new Text(s+"");
    }
    return element(s);
}

/**
 * MutationObserverを介して、DOMの変異をイベントストリームに接続する。
 * @param n 
 * @returns 
 */
const mutations = (n: Node) => (init: MutationObserverInit) : [Stream<MutationRecord[]>,()=>void] => {
    const s = stream<MutationRecord[]>();
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
    const s = stream<E>();
    const l = drip(s) as unknown as EventListener;
    target.addEventListener(t, l, false);
    return [s, target.removeEventListener.bind(target,t,l,false)];
}

/**
 * プレフィクス付きタグ名を自動解決して使うjshtml
 */
const jshtmlWithPrefixAuto = (prefix: string) => (node: JSHTMLNodeSource): Node  => {
    if (typeof node === "function") return jshtmlWithPrefixAuto(prefix)(node());
    if (Array.isArray(node)) {
        const df = new DocumentFragment();
        df.append(...node.map(jshtmlWithPrefixAuto(prefix)));
        return df;
    }

    if (node == null || typeof node !== "object") return jshtml(node);

    const tag = Object.keys(node).find(k => k !== "$");
    if (!tag) return jshtml(node);

    const maybeRealTag = tag.includes("-") 
        ? tag // すでに hyphenated
        : `${prefix}-${tag}`;

    const resolvedTag = customElements.get(maybeRealTag)
        ? maybeRealTag
        : tag;

    const mappedNode = { [resolvedTag]: node[tag], ...(node.$ ? { $: node.$ } : {}) };

    return jshtml(mappedNode);
};

export {jshtml, mutations, events, jshtmlWithPrefixAuto};


