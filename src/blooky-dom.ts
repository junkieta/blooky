/**
 * blooky-dom.ts
 * blookyを用いてリアクティブなDOMを構築するライブラリ。
 * 簡易な仕様でDOMを構築しつつ、Streamを利用した更新管理も行う。
 */
import type { V_DATASET, V_STYLE, V_CLASSLIST, V_EVENTLISTENER, V_STRING, WritableCSSProperty, JSHTMLElementSource, JSHTMLAttrSource, JSHTMLNodeSource, JSHTMLAttributeMapSource, T_ATTRSET } from "./blooky-dom-types";
import { type Stream, type Prop, type DripperStream, stream, drip, isChainedProp, filter, resolve, isDripperStream, when } from "./blooky";

// dripにDOMオブザーバー呼び出しを追加する
drip.registerEnhancer((effect) => {
    if(!effect.length) return effect;
    const first = effect[0];
    const update = (v:unknown) => {
        const update_target = [...PROP_BIND_MAP].flatMap((part)=>effect.find(({prop})=>prop===part.prop) ? part : []);
        PROP_BIND_MAP.forEach((a)=>{
            // 更新の発生したPropに包含されているPropはbindから外す
            if(!a.isConnected() || update_target.some((b)=>b.contains(a)&&a!==b))
                PROP_BIND_MAP.delete(a);
        })
        const listeners: (()=>void)[] = effect.flatMap((p) => {
            const v = p.nextValue;
            const t = update_target.filter((part)=>PROP_BIND_MAP.has(part) && p.prop === part.prop);
            return t.length
                ? [() => t.forEach((p)=>p.update(v as any, p.prop() as any))]
                : [];
        });
        listeners.forEach((f)=>f());
        first.update(v);
    };
    // 最初のPropEffectのupdateを上書きして、バインドされた要素の更新をPropの更新前に処理する
    return [{...first,update},...effect.slice(1)];
});

// PropとDOMのバインドに責任を持つ
type PropBridgeInterface<A> = {
    prop: Prop<A>
    isConnected() : boolean
    update(next:A,prev:A): void
    contains(p:PropBridge): boolean    
}

type PropBridge = (RangePropBridge | AttrPropBridge | StylePropBridge);

const PROP_BIND_MAP = new Set<PropBridge>();

// aにbが含まれているならtrue
const contains_range = (a:Range) => (b: Range) => {
    return b.compareBoundaryPoints(b.START_TO_START, a) >= 0 
        && b.compareBoundaryPoints(b.END_TO_END, a) <= 0;
} 

class RangePropBridge implements PropBridgeInterface<JSHTMLNodeSource> {
    prop: Prop<JSHTMLNodeSource>
    target: [Node, Node];
    constructor(p: Prop<JSHTMLNodeSource>, t: [Node, Node]) { 
        this.prop = p;
        this.target = t;
    }
    toRange() {
        const r = new Range();
        if(this.isSingleNode()) {
            r.selectNode(this.target[0]);
        } else {
            r.setStartBefore(this.target[0]);
            r.setEndAfter(this.target[1]);
        }
        return r;
    }
    isSingleNode() {
        return this.target[0] === this.target[1];
    }
    update(v:JSHTMLNodeSource, prev: JSHTMLNodeSource){
        const n = jshtml(v);
        const [_a,_b] = n.nodeType === n.DOCUMENT_FRAGMENT_NODE
            ? [n.firstChild!, n.lastChild!]
            : [n,n];
        if(this.isSingleNode()) {
            this.target[0].parentNode?.replaceChild(n, this.target[0])
        } else {
            const r = this.toRange();
            r.insertNode(n);
            r.setStartAfter(_b);
            r.deleteContents();
        }
        this.target = [_a,_b];
        return true;
    }
    isConnected() {
        return this.target.every((t)=>t.isConnected);
    }
    contains(p:PropBridge) {
        return contains_range(this.toRange())(p.toRange());
    }
}

abstract class AbstractAttrPropBridge<A> implements PropBridgeInterface<A> {
    prop: Prop<A>
    target: HTMLElement
    name: string
    
    abstract update(v: A, prev: A): void;
    
    constructor(p: Prop<A>, t:HTMLElement, n: string) {
        this.prop = p;
        this.target = t;
        this.name = n;
    }
    toRange() {
        const r = new Range();
        r.selectNode(this.target);
        return r;
    }
    isConnected() {
        return this.target.isConnected;
    }
    contains(p: PropBridge): boolean {
        return false; // 属性は特殊な例を除いて他のbridgeを包含しない
    }
}

class AttrPropBridge extends AbstractAttrPropBridge<JSHTMLAttrSource> {
    generatedListener?: (v:Event)=>void
    update(next: JSHTMLAttrSource, prev: JSHTMLAttrSource){
        if(next === prev) return;
        if(this.generatedListener) {
            this.target.removeEventListener(this.name.slice(2), this.generatedListener);
            delete this.generatedListener;
            if(isDripperStream(next)) next = this.generatedListener = createListenerForDripper(next);
        }
        update_attr([this.name,next] as T_ATTRSET)(this.target);
    }
    contains(p: PropBridge) {
        // 属性の詳細Bridgeでなければアウト
        if(!(p instanceof AbstractAttrPropBridge)) return false;
        if(p instanceof AttrPropBridge) return false;
        // 要素が違う時点でアウト
        if(this.target !== p.target) return false;
        return (p instanceof StylePropBridge && this.name === "style")
            || (p instanceof DatasetPropBridge && this.name === "dataset");
    }
}

class StylePropBridge extends AbstractAttrPropBridge<V_STRING> {
    update(v: V_STRING, prev: V_STRING) {
        if(v !== prev) set_css_property(this.name, v != null ? v + "" : "")(this.target.style);
    }
}

class DatasetPropBridge extends AbstractAttrPropBridge<V_STRING> {
    update(v: V_STRING, prev: V_STRING) {
        if(v !== prev) this.target.dataset[this.name] = v == null ? "" : v+"";
    }
}


// 即時dripの短縮呼び出し関数。イベントリスナーとして登録する想定。
// ex) onclick: into(eventDripperStream)
const into = <A>(d: DripperStream<A>) => (v: A) => {
    drip(v)(d).forEach(({update,nextValue})=>update(nextValue));
}

/**
 * tag指定がjshtmlの仕様に沿わなかった場合に生成される要素の定義。
 */
class JSHTMLUnknownElement extends HTMLElement {}
customElements.define("jshtml-unknown", JSHTMLUnknownElement);


// class属性の設定用関数を生成する
const gen_className_setter = (v:V_CLASSLIST|V_STRING) :(e:Element)=>void => 
    v == null
    ? (e:Element) => e.removeAttribute("class")
    : Array.isArray(v)
    ? (e:Element) => e.className = v.filter(Boolean).join(" ")
    : (e:Element) => e.className = typeof v === "object"
        ? Object.keys(v).filter((k)=>v[k]).join(" ")
        : v + "";

// datasetの設定用関数を生成する
const gen_dataset_setter =
    (v:V_DATASET|null) =>
        v == null
        ? (e:HTMLElement) => Object.keys(e.dataset).forEach((k)=> delete e.dataset[k])
        : (e:HTMLElement) => {
            Object.keys(e.dataset).filter((k)=>!(k in v)).forEach((k)=>delete e.dataset[k]);
            Object.entries(v).forEach(([k,v]) => {
                if(isChainedProp(v)) {
                    PROP_BIND_MAP.add(new DatasetPropBridge(v,e,k));
                    v = v();
                }
                e.dataset[k] = v != null ? v + "" : '';
            });
        }

// インラインスタイルの設定用関数を生成する
const gen_style_setter =
    (v:V_STYLE) =>
        v == null
        ? (e:HTMLElement) => e.removeAttribute("style")
        : (e:HTMLElement) => {
            e.removeAttribute("style");
            (Object.entries(v) as [WritableCSSProperty,V_STRING|Prop<V_STRING>][]).forEach(([k,v]) => {
                if(isChainedProp(v)) {
                    PROP_BIND_MAP.add(new StylePropBridge(v,e,k));
                    v = v();
                }
                set_css_property(k,v != null ? v + "": "")(e.style);
            })
        }

const set_css_property = (n: WritableCSSProperty|string, v: string) => (d: CSSStyleDeclaration) => {
    if(n.startsWith("--"))
        d.setProperty(n, v);
   else
        d[n] = v;
}
 

// イベントリスナーの設定用関数を生成する
const gen_listener_setter =
    (v:V_EVENTLISTENER, n: string) => 
        isDripperStream(v)
        ? gen_listener_setter(createListenerForDripper(v), n)
        : v && (typeof v === "function" || typeof v.handleEvent === "function")
        ? (e:EventTarget) => e.addEventListener(n.slice(2), v as EventListener)
        : (e:Element) => e.setAttribute(n,v+"");

// DripperStreamにdripするリスナーを生成する
const createListenerForDripper = (d:DripperStream<any>) => function _(e:Event) {
    const t = (e.currentTarget as HTMLElement);
    if(t.isConnected)
        into(d)(e);
    else {
        t.removeEventListener(e.type, _);
    }
};

type JSHTMLExtractedElementSource = [tag: string, children: JSHTMLNodeSource, attrs?: JSHTMLAttributeMapSource];

/**
 * 仕様に沿った要素を生成する
 * @param s 
 * @returns 
 */
const element = (s:JSHTMLElementSource) => {
    const [tag,children,attrs] = extractElementSource(s);
    const elm = document.createElement(tag);
    if(attrs) {
        Object.entries(attrs).forEach(([k,v])=> {
            if(isChainedProp(v)) {
                PROP_BIND_MAP.add(new AttrPropBridge(v as Prop<JSHTMLAttrSource>, elm, k));
                v = v() as T_ATTRSET[1];
            }
            update_attr([k,v] as T_ATTRSET)(elm);
        })
    }
    if(children)
        elm.append(jshtml(children));
    return elm;
}

/**
 * JSHTMLElementSourceを部品に分割して返す
 * @param s 
 * @returns 
 */
const extractElementSource = (s:JSHTMLElementSource) : JSHTMLExtractedElementSource => {
    const tag = Object.keys(s).find((t)=>t !== "$");
    if(!tag) {
        console.error("invalid tag name err:", tag);
        return ["jshtml-unknown", null];
    }
    const children = s[tag] as JSHTMLNodeSource;
    const attrs = "$" in s ? (s.$ as JSHTMLAttributeMapSource) : undefined;
    return !attrs && children instanceof EmptyElementAttributeMapSource
        ? [tag,null,children.source]
        : [tag,children,attrs];
}

// 属性別の更新方法を振り分けたハンドラ
const attrUpdteHandler = {
    "classList": ([n,v,e]:[string,any,HTMLElement]) => gen_className_setter(v)(e),
    "dataset": ([n,v,e]:[string,any,HTMLElement]) => gen_dataset_setter(v)(e),
    "style": ([n,v,e]:[string,any,HTMLElement]) => gen_style_setter(v)(e),
    "default": ([n,v,e]:[string,any,HTMLElement]) => {
        if(typeof v === "boolean")
            e.toggleAttribute(n, v);
        else if(/^on+/.test(n))
            gen_listener_setter(v as V_EVENTLISTENER, n)(e);
        else if(!(v instanceof Object))
            e.setAttribute(n, v + "");
        else {
            console.log(n,v);
            throw new Error("unknown attribute's value");
        }
    }
}

/**
 * HTML要素の属性値を更新する
 * @param e 
 * @returns 
 */
const update_attr = ([n,v]:T_ATTRSET) => (e:HTMLElement) => {
    if(v == null)
        e.removeAttribute(n);
    else if(n in attrUpdteHandler)
        attrUpdteHandler[n]([n,v,e]);
    else
        attrUpdteHandler.default([n,v,e]);
};

class PromisedElement extends HTMLElement {
    promise: Promise<JSHTMLNodeSource|Node>
    constructor(promise: Promise<JSHTMLNodeSource|Node>) {
        super();
        this.promise = promise;
    }
    connectedCallback() {
        this.promise.then((n)=>{
            if(this.parentNode) this.parentNode.replaceChild(n instanceof Node ? n : jshtml(n), this);
        })
    }
}
customElements.define("promised-placeholder", PromisedElement);

const promised = (p: Promise<JSHTMLNodeSource|Node>, msg: JSHTMLNodeSource) => {
    const element = new PromisedElement(p);
    if(msg != null)
        element.append(jshtml(msg));
    else
        element.style.display = "none";
    return element;
}

/**
 * jshtml仕様に沿ったDOMを生成して返し、Propは生成結果をバインディングする。
 * @param s 
 * @returns 
 */
function jshtml(s:Node|JSHTMLNodeSource|Prop<JSHTMLNodeSource>): Node {
    if(s instanceof Node)
        return s instanceof HTMLTemplateElement ? s.content.cloneNode(true) : s;
    if(s instanceof Promise)
        return new PromisedElement(s);
    if(typeof s === "function") {
        let n = jshtml(s());
        let p: [Node,Node];
        if(n.nodeType !== n.DOCUMENT_FRAGMENT_NODE) {
            p = [n,n];
        }
        else if(n.hasChildNodes()) {
            p = [n.firstChild!,n.lastChild!];
        }
        else { // 子要素のないDocumentFragmentはプレースホルダーとみなす
            n = new Comment("[jshtml::placeholder]");
            p = [n,n];
        }
        PROP_BIND_MAP.add(new RangePropBridge(s, p));
        return n;
    }
    if(Array.isArray(s)) {
        const df = document.createDocumentFragment();
        df.append(...s.map((s)=>jshtml(s)));
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

export class EmptyElementAttributeMapSource {
    source: JSHTMLAttributeMapSource
    constructor(source:JSHTMLAttributeMapSource){
        this.source = source;
    }
}
jshtml.$ = (attrs: JSHTMLAttributeMapSource) => new EmptyElementAttributeMapSource(attrs);

/**
 * MutationObserverを介して、DOMの変異をイベントストリームに接続する。
 * @param n 
 * @returns 
 */
const mutations = (init: MutationObserverInit) => (n: Node) : [Stream<MutationRecord[]>,()=>void] => {
    const s = stream<MutationRecord[]>();
    const o = new MutationObserver(into(s));
    o.observe(n, init);
    return [s, o.disconnect.bind(o)];
};

// addEventListenerを介して、DOMイベントをイベントストリームに接続する。
const events = <T extends string, E = T extends keyof HTMLElementEventMap ? HTMLElementEventMap[T] : Event>(t: T) => (target:EventTarget) : [Stream<E>,()=>void] => {
    const s = stream<E>();
    const l = into(s) as EventListener;
    target.addEventListener(t, l, false);
    return [s, target.removeEventListener.bind(target,t,l,false)];
}

// プレフィクス付きタグ名を自動解決して使うjshtml
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

    const maybeRealTag = `${prefix}-${tag}`;
    const resolvedTag = customElements.get(maybeRealTag)
        ? maybeRealTag
        : tag;

    const mappedNode = {
        [resolvedTag]: node[tag],
        $: "$" in node ? node.$ : undefined
    };

    return jshtml(mappedNode);
};


export {into, promised, jshtml, mutations, events, jshtmlWithPrefixAuto};
