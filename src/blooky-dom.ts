/**
 * blooky-dom.ts
 * blookyを用いてリアクティブなDOMを構築するライブラリ。
 * 簡易な仕様でDOMを構築しつつ、Streamを利用した更新管理も行う。
 */
import type { V_DATASET, V_STYLE, V_CLASSLIST, V_EVENTLISTENER, V_STRING, WritableCSSProperty, JSHTMLElementSource, JSHTMLAttrSource, JSHTMLNodeSource, JSHTMLAttributeMapSource } from "./blooky-dom-types";
import { type Stream, type Prop, type DripperStream, stream, drip, isChainedProp, isDripperStream, registerTickHandler, collapse } from "./blooky-fp";

// DOMをfpのtickに結び付ける
registerTickHandler("visual", (effects) => {
    const update_target = effects.flatMap((e) => [...e.effects.keys()].flatMap((p)=>PROP_BRIDGE_RECORD.has(p) ? PROP_BRIDGE_RECORD.get(p)! : []));

    // ツリーから外れたものと、更新の発生したPropに包含されているPropはbindから外す
    const isGCTarget = (a:PropBridge) => !a.isConnected() || update_target.some((b)=>b.contains(a)&&a!==b);
    PROP_BRIDGE_RECORD.forEach((bridge,prop)=>{
        if(!Array.isArray(bridge)) {
            if(isGCTarget(bridge))
                PROP_BRIDGE_RECORD.delete(prop);
        } else {
            const filtered = bridge.filter((b)=>!isGCTarget(b));
            if(!filtered.length) 
                PROP_BRIDGE_RECORD.delete(prop);
            else if(filtered.length < bridge.length)
                PROP_BRIDGE_RECORD.set(prop, filtered);
        }
    });
    effects.forEach((e)=>e.effects.forEach((v,p)=>{
        if(!PROP_BRIDGE_RECORD.has(p)) return;
        const prev = p() as any;
        const bridges = update_target.filter((bridge)=>bridge.prop === p);
        bridges.forEach((bridge)=>bridge.update(v,prev));
    }));
})


// PropとDOMのバインドに責任を持つ
type PropBridgeInterface<A> = {
    prop: Prop<A>
    isConnected() : boolean
    update(next:A,prev:A): void
    contains(p:PropBridge): boolean    
}

type PropBridge = (RangePropBridge | AttrPropBridge | StylePropBridge);

// 最適化用に共用型
const PROP_BRIDGE_RECORD = new Map<Prop<any>, PropBridge|PropBridge[]>();
const bindRecord = (p:Prop<any>, b:PropBridge) => {
    if(!PROP_BRIDGE_RECORD.has(p)) {
        PROP_BRIDGE_RECORD.set(p, b);
    } else {
        const value = PROP_BRIDGE_RECORD.get(p)!;
        if(Array.isArray(value)) {
            value.push(b);
        } else {
            PROP_BRIDGE_RECORD.set(p, [value, b]);
        }
    }
}

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
        // 通知イベント用に確保
        const previous : Node[] = this.target;
        const n = jshtml(v);
        const [_a,_b] = n.nodeType === n.DOCUMENT_FRAGMENT_NODE
            ? [n.firstChild!, n.lastChild!]  
            : [n,n];
        if(this.isSingleNode()) {
            previous[0].parentNode?.replaceChild(n, previous[0])
        } else {
            const r = this.toRange();
            r.insertNode(n);
            r.setStartAfter(_b);
            r.deleteContents();
        }
        this.target = [_a,_b];
        
        const prevValue = new DocumentFragment();
        prevValue.append(...previous);

        const target = _a === _b ? _a : _a.parentNode!;
        target.dispatchEvent(new CustomEvent("node-prop-update", { detail: { prop: this.prop, prevValue } }));
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
    protected dispatchModifiedEvent(type: string, next:A, prev:A) {
        this.target.dispatchEvent(new CustomEvent(type, {
            detail: {
                prop: this.prop,
                name: this.name,
                nextValue: next,
                prevValue: prev
            }
        }));
    }
}

class AttrPropBridge extends AbstractAttrPropBridge<JSHTMLAttrSource> {
    generatedListener?: EventListenerOrEventListenerObject
    update(next: JSHTMLAttrSource, prev: JSHTMLAttrSource){
        if(next === prev) return;
        const {name,target} = this;
        if(this.generatedListener) {
            target.removeEventListener(name.slice(2), this.generatedListener);
            delete this.generatedListener;
        }
        if(isDripperStream(next))
            next = this.generatedListener = createTracableListener(next);
        else if("on".startsWith(name))
            this.generatedListener = next as EventListenerOrEventListenerObject;
        updateAttr({ name, target, value: next });
        this.dispatchModifiedEvent("attr-prop-modified", next, prev);
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
        if(v === prev) return;
        setCSSProperty(this.name, v != null ? v + "" : "")(this.target.style);
        this.dispatchModifiedEvent("style-prop-update", v, prev);
    }
}

class DatasetPropBridge extends AbstractAttrPropBridge<V_STRING> {
    update(v: V_STRING, prev: V_STRING) {
        if(v === prev) return;
        this.target.dataset[this.name] = v == null ? "" : v+"";
        this.dispatchModifiedEvent("dataset-prop-update",v,prev);
    }
}

// PROPの観測。イベントリスナーとして登録する想定。
// ex) onclick: collapse(eventDripperStream)
const createTracableListener = <A>(d: DripperStream<A>) => (v: A) => {
    const dripEffect = drip(v)(d);
    if(v instanceof Event) {
        const collapseEvt = new CustomEvent("blooky-collapse", {
            cancelable: true,
            detail: dripEffect
        });
        if(!v.target?.dispatchEvent(collapseEvt)) return;
    }
    collapse(dripEffect);
}


/**
 * tag指定がjshtmlの仕様に沿わなかった場合に生成される要素の定義。
 */
class JSHTMLUnknownElement extends HTMLElement {}
customElements.define("jshtml-unknown", JSHTMLUnknownElement);

// class属性の設定用関数を生成する
const genClassNameSetter = (v:V_CLASSLIST|V_STRING) :(e:Element)=>void => 
    v == null
    ? (e:Element) => e.removeAttribute("class")
    : Array.isArray(v)
    ? (e:Element) => e.className = v.filter(Boolean).join(" ")
    : (e:Element) => e.className = typeof v === "object"
        ? Object.keys(v).filter((k)=>v[k]).join(" ")
        : v + "";

// datasetの設定用関数を生成する
const genDatasetSetter =
    (v:V_DATASET|null) =>
        v == null
        ? (e:HTMLElement) => Object.keys(e.dataset).forEach((k)=> delete e.dataset[k])
        : (e:HTMLElement) => {
            Object.keys(e.dataset).filter((k)=>!(k in v)).forEach((k)=>delete e.dataset[k]);
            Object.entries(v).forEach(([k,v]) => {
                if(isChainedProp(v)) {
                    bindRecord(v, new DatasetPropBridge(v,e,k));
                    v = v();
                }
                e.dataset[k] = v != null ? v + "" : '';
            });
        }

// インラインスタイルの設定用関数を生成する
const genStyleSetter =
    (v:V_STYLE) =>
        v == null
        ? (e:HTMLElement) => e.removeAttribute("style")
        : (e:HTMLElement) => {
            e.removeAttribute("style");
            (Object.entries(v) as [WritableCSSProperty,V_STRING|Prop<V_STRING>][]).forEach(([k,v]) => {
                if(isChainedProp(v)) {
                    bindRecord(v, new StylePropBridge(v,e,k));
                    v = v();
                }
                setCSSProperty(k,v != null ? v + "": "")(e.style);
            })
        }

const setCSSProperty = (n: WritableCSSProperty|string, v: string) => (d: CSSStyleDeclaration) => {
    if(n.startsWith("--"))
        d.setProperty(n, v);
   else
        d[n as WritableCSSProperty] = v;
}
 

// イベントリスナーの設定用関数を生成する
const genListenerSetter =
    (v:V_EVENTLISTENER, n: string) => 
        isDripperStream(v)
        ? (e:EventTarget) => e.addEventListener(n.slice(2), createTracableListener(v))
        : v && (typeof v === "function" || typeof v.handleEvent === "function")
        ? (e:EventTarget) => e.addEventListener(n.slice(2), v as EventListener)
        : (e:Element) => e.setAttribute(n,v+"");

type JSHTMLExtractedElementSource = [tag: string, children: JSHTMLNodeSource, attrs?: JSHTMLAttributeMapSource];

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

const ATTRIBUTE_HANDLER_RREGISTRY: { [key:string]: <V>(runtime:JSHTMLAttrRuntime<V>) => boolean|void } = Object.create(null);
const defineAttrUpdateHandlers = (handlers: { [key:string]: (value: any, target: HTMLElement) => boolean }) => {
    const defined = Object.keys(handlers).filter((k)=>k in ATTRIBUTE_HANDLER_RREGISTRY);
    if(defined.length)
        throw new Error(`"${defined.join('","')}" already defined attr handler name`);
    Object.assign(ATTRIBUTE_HANDLER_RREGISTRY, handlers);
}


const jshtmlAttrHandler = {
    "classList": ({value,target}:JSHTMLAttrRuntime<V_CLASSLIST>) => genClassNameSetter(value)(target),
    "dataset": ({value,target}:JSHTMLAttrRuntime<V_DATASET>) => genDatasetSetter(value)(target),
    "style": ({value,target}:JSHTMLAttrRuntime<V_STYLE>) => genStyleSetter(value)(target),
}

/**
 * HTML要素の属性値を更新する
 * @param e 
 * @returns 
 */
const updateAttr = <V>(runtime: JSHTMLAttrRuntime<V>) => {
    const {value,name,target} = runtime;
    if(value == null)
        target.removeAttribute(name);
    else if(typeof jshtmlAttrHandler[name as keyof typeof jshtmlAttrHandler] === "function")
        jshtmlAttrHandler[name as keyof typeof jshtmlAttrHandler](runtime as any);
    else if(name in ATTRIBUTE_HANDLER_RREGISTRY && ATTRIBUTE_HANDLER_RREGISTRY[name](runtime) === false)
        return;
    else if(typeof value === "boolean")
        target.toggleAttribute(name, value);
    else if(/^on/.test(name))
        genListenerSetter(value as V_EVENTLISTENER, name)(target);
    else if(!(value instanceof Object))
        target.setAttribute(name, value + "");
    else {
        console.log(name,value);
        throw new Error("unknown attribute's value");
    }
};

class PromisedElement extends HTMLElement {
    promise: Promise<JSHTMLNodeSource|Node>
    constructor(promise: Promise<JSHTMLNodeSource|Node>) {
        super();
        this.promise = promise;
    }
    connectedCallback() {
        this.promise.then((n)=>{
            const node = n instanceof Node ? n : jshtml(n);
            this.dispatchEvent(new CustomEvent("resolvepromise", {
                bubbles: true,
                detail: { value: node }
            }));
            if(this.parentNode) this.parentNode.replaceChild(node, this);
        }).catch((error)=>{
            if(this.dispatchEvent(new CustomEvent("rejectpromise", {
                cancelable: true,
                bubbles: true,
                detail: { error }
            }))) throw error;
        });
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

export class EmptyElementAttributeMapSource {
    source: JSHTMLAttributeMapSource
    constructor(source:JSHTMLAttributeMapSource){
        this.source = source;
    }
}

/**
 * MutationObserverを介して、DOMの変異をイベントストリームに接続する。
 * @param n 
 * @returns 
 */
const mutations = (init: MutationObserverInit) => (n: Node) : [Stream<MutationRecord[]>,()=>void] => {
    const s = stream<MutationRecord[]>();
    const o = new MutationObserver(createTracableListener(s));
    o.observe(n, init);
    return [s, o.disconnect.bind(o)];
};

// addEventListenerを介して、DOMイベントをイベントストリームに接続する。
const events = <T extends string, E = T extends keyof HTMLElementEventMap ? HTMLElementEventMap[T] : Event>(t: T) => (target:EventTarget) : [Stream<E>,()=>void] => {
    const s = stream<E>();
    const l = createTracableListener(s) as EventListener;
    target.addEventListener(t, l, false);
    return [s, target.removeEventListener.bind(target,t,l,false)];
}

type JSHTMLNodeSourceType = 
    | "node"
    | "promise"
    | "prop"
    | "array"
    | "nullable"
    | "text"
    | "element"
;

type JSHTMLNodeRuntime<T> = {
    build: (s:JSHTMLNodeSource) => Node
    source: T
    context?: Record<string,any>
}

const JSHTML_ELEMENT_HANDLER = Symbol("JSHTML_ELEMENT_FACTORY");

const JSHTML_ATTR_HANDLER = Symbol("JSHTML_ATTR_HANDLER");

type JSHTMLAttrRuntime<T> = {
    name: string
    value: T
    target: HTMLElement
    context?: Record<string,any>
}

/**
 * jshtml仕様に沿ったDOMを生成して返し、Propは生成結果をバインディングする。
 * @param s 
 * @returns 
 */
const jshtml = (source: JSHTMLNodeSource, context?: Record<string,any>) => {
    const build: (source: JSHTMLNodeSource) => Node = (source: JSHTMLNodeSource) => {
        const type = analyzeNodeSource(source);
        return nodeFactory[type]({ source, context, build } as JSHTMLNodeRuntime<any>);
    };
    return build(source);
}
jshtml.$ = (attrs: JSHTMLAttributeMapSource) => new EmptyElementAttributeMapSource(attrs);

const analyzeNodeSource = (s: JSHTMLNodeSource): JSHTMLNodeSourceType => {
    if(s instanceof Node) return "node";
    if(s instanceof Promise) return "promise";
    if(typeof s === "function") return "prop";
    if(Array.isArray(s)) return "array";
    if(s == null || s == undefined) return "nullable";
    if(typeof s !== "object") return "text";
    return "element";
}

const nodeFactory = {
    "node": ({source}:JSHTMLNodeRuntime<Node>) => source.nodeName === "TEMPLATE" ? (source as HTMLTemplateElement).content.cloneNode(true) : source,
    "promise": ({source}:JSHTMLNodeRuntime<Promise<JSHTMLNodeSource>>) => new PromisedElement(source),
    "prop": ({source,build}:JSHTMLNodeRuntime<Prop<JSHTMLNodeSource>>) => {
        let n = build(source());
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
        bindRecord(source, new RangePropBridge(source, p));
        return n;
    },
    "array": ({source,build}:JSHTMLNodeRuntime<JSHTMLNodeSource[]>) => { const df = new DocumentFragment(); df.append(...source.map(build)); return df; },
    "nullable": (_:JSHTMLNodeRuntime<null|undefined>) => new Comment("jshtml:nullable"),
    "text": ({source}:JSHTMLNodeRuntime<any>) => new Text(source+""),
    "element": (runtime:JSHTMLNodeRuntime<JSHTMLElementSource>) => {
        const {source,build,context} = runtime;
        const [tag,children,attributes] = extractElementSource(source);
        const elmClass = customElements.get(tag)!;
        const elm = document.createElement(tag);
        if(attributes) {
            const customElementAttrHandler = elmClass && JSHTML_ATTR_HANDLER in elmClass
                ? elmClass[JSHTML_ATTR_HANDLER] as { [key:string]: (v:JSHTMLAttrRuntime<any>)=>boolean|void }
                : {};
            for(let name in attributes) {
                let value = attributes[name];
                const runtime = { target: elm, name, value, context };
                if(name in customElementAttrHandler && customElementAttrHandler[name](runtime) === false) 
                    continue; // ハンドラがfalseを返したら、後続の処理はしない
                if(isChainedProp(value)) {
                    bindRecord(value, new AttrPropBridge(value as Prop<JSHTMLAttrSource>, elm, name));
                    updateAttr({...runtime,value:value()});
                }
                else updateAttr(runtime);
            }
        }
        if(children)
            elm.append(build(children));
        if(elmClass && JSHTML_ELEMENT_HANDLER in elm)
            (elm[JSHTML_ELEMENT_HANDLER] as Function)(context);
        return elm;
    },
}


export {
    defineAttrUpdateHandlers,
    createTracableListener,
    promised, jshtml, mutations, events,
    JSHTMLNodeRuntime,JSHTMLAttrRuntime,
    JSHTML_ELEMENT_HANDLER,
    JSHTML_ATTR_HANDLER 
};
