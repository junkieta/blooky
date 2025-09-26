/**
 * blooky-dom.ts
 * blookyを用いてリアクティブなDOMを構築するライブラリ。
 * 簡易な仕様でDOMを構築しつつ、Streamを利用した更新管理も行う。
 */
import type { V_DATASET, V_STYLE, V_CLASSLIST, V_EVENTLISTENER, V_STRING, WritableCSSProperty, JSHTMLElementSource, JSHTMLAttrSource, JSHTMLNodeSource, JSHTMLAttributeMapSource, JSHTMLAttrRuntime, JSHTMLNodeRuntime, JSHTMLNodeSourceType, JSHTMLExtractedElementSource, JSHTMLNodeFactory, JSHTMLNodeSourceAnalyzer, BlookyMutationEvent, JSHTMLAttrAnalyzer, JSHTMLAttrBuilder } from "./blooky-dom-types";
import { registerTickHandler, isDripperStream, drip, collapse, isChainedProp, blooky, stream } from "./blooky-fp";
import { Prop, DripperStream, Stream, BlookyError } from "./blooky-types";

// DOMをfpのtickに結び付ける
registerTickHandler("visual", (effects) => {
    const update_target = effects.flatMap((e) => [...e.effects.keys()].flatMap((p)=>PROP_BRIDGE_RECORD.has(p) ? PROP_BRIDGE_RECORD.get(p)! : []));
    // ツリーから外れたものと、更新の発生したPropに包含されているPropはbindから外す
    const isGCTarget = (a:PropBridge) => !a.isConnected() || update_target.some((b)=>b.contains(a)&&a!==b);
    // メモリ解放
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
    // メモリに確保されているbridgeからアップデートする
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

const PROP_BRIDGE_RECORD = new Map<Prop<any>, PropBridge|PropBridge[]>();// 最適化用に共用型
const bindPropBridge = (b:PropBridge) => {
    const p = b.prop;
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
const contains_range = (a: Range) => (b: Range) => {
    // a の開始 <= b の開始 かつ a の終了 >= b の終了 なら a は b を包含する
    return a.compareBoundaryPoints(Range.START_TO_START, b) <= 0
        && a.compareBoundaryPoints(Range.END_TO_END, b) >= 0;
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
        // 生成したノードを境界のアンカー用ペアとして変数に保存
        let a: Node, b: Node;
        if(n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE)
            a = b = n;
        else if(!n.hasChildNodes())
            a = b = n.appendChild(new Comment("[jshtml-placeholder]"));
        else
            a = n.firstChild!, b = n.lastChild!;
        
        if(this.isSingleNode()) {
            previous[0].parentNode?.replaceChild(n, previous[0])
        } else {
            const r = this.toRange();
            r.insertNode(n);
            r.setStartAfter(b);
            r.deleteContents();
            r.detach();
        }
        this.target = [a,b];
        
        const dispather = a === b ? a : a.parentNode!;
        dispather.dispatchEvent(new CustomEvent("node-prop-update", { detail: { prop: this.prop, nextValue: this.target, prevValue: previous } }));
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
    protected dispatchPropUpdateEvent(type: string, next:A, prev:A) {
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
        if(isDripperStream<Event>(next))
            next = this.generatedListener = listenerForCollapse(next);
        else if(name.startsWith("on"))
            this.generatedListener = next as EventListenerOrEventListenerObject;
        const attrType = analyzeAttrSource(name, next);
        jshtmlAttrBuilder[attrType]({ name, target, value: next as any });
        this.dispatchPropUpdateEvent("attr-prop-update", next, prev);
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
        this.dispatchPropUpdateEvent("style-prop-update", v, prev);
    }
}

class DatasetPropBridge extends AbstractAttrPropBridge<V_STRING> {
    update(v: V_STRING, prev: V_STRING) {
        if(v === prev) return;
        this.target.dataset[this.name] = v == null ? "" : v+"";
        this.dispatchPropUpdateEvent("dataset-prop-update",v,prev);
    }
}

// PROPの観測。イベントリスナーとして登録し、collapseの実行とDOMイベントを接続する。
const listenerForCollapse = <A extends Event>(d: DripperStream<A>) => (v: A) => {
    const target = v.currentTarget || v.target;
    if (!target) {
        console.warn('listenerForCollapse: no target available');
        return;
    }
    const dripEffect = drip(v)(d);
    if(target.dispatchEvent(new CustomEvent("blooky-collapse-start", {
        cancelable: true,
        bubbles: true,
        detail: dripEffect
    }))) {
        collapse(dripEffect)
            .then((resolved)=>{
                target.dispatchEvent(new CustomEvent("blooky-collapse-completed", {
                    bubbles: true,
                    detail: Object.assign({resolved},dripEffect)
                }))
            })
            .catch((rejected: BlookyError<any>[])=>{
                target.dispatchEvent(new CustomEvent("blooky-collapse-failed", {
                    bubbles: true,
                    detail: Object.assign({rejected},dripEffect)
                }))
            })
    } else {
        // キャンセルされた場合の通知
        target.dispatchEvent(new CustomEvent("blooky-collapse-cancelled", {
            bubbles: true,
            detail: dripEffect
        }));
    }
}


/**
 * tag指定がjshtmlの仕様に沿わなかった場合に生成される要素の定義。
 */
class JSHTMLUnknownElement extends HTMLElement {}
customElements.define("jshtml-unknown", JSHTMLUnknownElement);

// cssvarへの対応
const setCSSProperty = (n: WritableCSSProperty|string, v: string) => (cssDec: CSSStyleDeclaration) => {
    if(n.startsWith("--"))
        cssDec.setProperty(n, v);
   else
        cssDec[n as WritableCSSProperty] = v;
}

// イベントリスナーの設定用関数を生成する
const createEventListenerSetter =
    (v:V_EVENTLISTENER, n: string) => 
        isDripperStream<Event>(v)
        ? (e:EventTarget) => e.addEventListener(n.slice(2), listenerForCollapse(v))
        : v && (typeof v === "function" || typeof (v as EventListenerObject).handleEvent === "function")
        ? (e:EventTarget) => e.addEventListener(n.slice(2), v as EventListenerOrEventListenerObject)
        : (e:Element) => e.setAttribute(n,v+"");

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
        throw blooky.error('dev-config', {
            code: 'DUPLICATE_ATTR_HANDLER',
            message: `Attribute handlers already defined: ${defined.join('", "')}`,
            duplicateHandlers: defined,
            suggestions: ['Check for duplicate handler registrations']
        });
    Object.assign(ATTRIBUTE_HANDLER_RREGISTRY, handlers);
}


class PromisedElement extends HTMLElement {
    promise: Promise<JSHTMLNodeSource|Node>
    constructor(promise: Promise<JSHTMLNodeSource|Node>) {
        super();
        this.promise = promise;
    }
    connectedCallback() {
        if(!this.promise) return;
        this.promise.then((n)=>{
            const node = n instanceof Node ? n : jshtml(n);
            this.dispatchEvent(new CustomEvent("promise-resolved", {
                bubbles: true,
                detail: { value: node }
            }));
            if(this.parentNode) this.parentNode.replaceChild(node, this);
        }).catch((error)=>{
            if(this.dispatchEvent(new CustomEvent("promise-rejected", {
                cancelable: true,
                bubbles: true,
                detail: { error }
            }))) throw blooky.error("user", {
                code: "REJECTTED_PROMISED_ELEMENT",
                message: '"promise-rejected" event is not prevented',
                originalError: error,
                suggestions: ['set "promise-rejected" listener and call "preventDefault"']
            });
        });
    }
}
customElements.define("blooky-promised-placeholder", PromisedElement);

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
 */
const mutations = (init: MutationObserverInit) => (n: Node) : Stream<BlookyMutationEvent> => {
    const s = stream<BlookyMutationEvent>();
    const l = listenerForCollapse(s);
    const o = new MutationObserver((records, observer)=>{
        if(n.dispatchEvent(new CustomEvent("blooky-observe-mutations", {
            bubbles: true,
            cancelable: true,
            detail: { records, observer }
        }))) return;
        observer.disconnect();
        n.removeEventListener("blooky-observe-mutations", l as EventListener);
    });
    n.addEventListener("blooky-observe-mutations", l as EventListener);
    o.observe(n, init);
    return s;
};

const JSHTML_ELEMENT_HANDLER = Symbol("JSHTML_ELEMENT_FACTORY");

const JSHTML_ATTR_HANDLER = Symbol("JSHTML_ATTR_HANDLER");


/**
 * jshtml仕様に沿ったDOMを生成して返し、Propは生成結果をバインディングする。
 * @param s 
 * @returns 
 */
function jshtml(this: object|void, source: JSHTMLNodeSource, context?: Record<string,any>) {
    const build = (source: JSHTMLNodeSource) : Node => {
        const type = analyzeNodeSource(source);
        return nodeFactory[type]({ source, build, context: this || context } as JSHTMLNodeRuntime<any>);
    };
    return build(source);
}

jshtml.$ = (attrs: JSHTMLAttributeMapSource) => new EmptyElementAttributeMapSource(attrs);

const analyzeNodeSource: JSHTMLNodeSourceAnalyzer = (s: JSHTMLNodeSource): JSHTMLNodeSourceType => {
    if(s instanceof Node) return "node";
    if(s instanceof Promise) return "promise";
    if(typeof s === "function") return "prop";
    if(Array.isArray(s)) return "array";
    if(s == null || s == undefined) return "nullable";
    if(typeof s !== "object") return "text";
    return "element";
}

const nodeFactory: JSHTMLNodeFactory = {
    "node": ({source}:JSHTMLNodeRuntime<Node>) => source.nodeName === "TEMPLATE" ? (source as HTMLTemplateElement).content.cloneNode(true) : source,
    "promise": ({source}:JSHTMLNodeRuntime<Promise<JSHTMLNodeSource>>) => new PromisedElement(source),
    "prop": ({source,build}:JSHTMLNodeRuntime<Prop<JSHTMLNodeSource>>) => {
        const n = build(source());
        let a: Node, b: Node;
        if(n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
            a = b = n;
        } else if(!n.hasChildNodes()) {
            a = b = n.appendChild(new Comment("[jshtml-placeholder]"));
        } else {
            a = n.firstChild!, b = n.lastChild!;
        }
        bindPropBridge(new RangePropBridge(source, [a,b]));
        return n;
    },
    "array": ({source,build}:JSHTMLNodeRuntime<JSHTMLNodeSource[]>) => { const df = new DocumentFragment(); df.append(...source.map(build)); return df; },
    "nullable": (_:JSHTMLNodeRuntime<null|undefined>) => new Comment("jshtml:nullable"),
    "text": ({source}:JSHTMLNodeRuntime<any>) => new Text(source+""),
    "element": (runtime:JSHTMLNodeRuntime<JSHTMLElementSource>) => {
        const {source,build,context} = runtime;
        const [tag,children,attributes] = extractElementSource(source);
        const elmClass = customElements.get(tag);
        const elm = document.createElement(tag);
        if(attributes) {
            const customElementAttrHandler = elmClass && JSHTML_ATTR_HANDLER in elmClass
                ? elmClass[JSHTML_ATTR_HANDLER] as { [key:string]: (v:JSHTMLAttrRuntime<any>)=>boolean|void }
                : {};
            for(const name in attributes) {
                const value = attributes[name];
                const runtime = { target: elm, name, value, context };
                if(name in customElementAttrHandler && customElementAttrHandler[name](runtime) === false) 
                    continue; // ハンドラがfalseを返したら、後続の処理はしない
                // Propの適用
                if(isChainedProp<JSHTMLAttrSource>(value)) {
                    bindPropBridge(new AttrPropBridge(value, elm, name));
                    runtime.value = value();
                }
                if(!(name in ATTRIBUTE_HANDLER_RREGISTRY) || ATTRIBUTE_HANDLER_RREGISTRY[name](runtime) !== false)
                    jshtmlAttrBuilder[analyzeAttrSource(runtime.name,runtime.value)](runtime);
            }
        }
        if(children)
            elm.append(build(children));
        if(elmClass && JSHTML_ELEMENT_HANDLER in elm)
            (elm[JSHTML_ELEMENT_HANDLER] as Function)(context);
        return elm;
    },
}

const analyzeAttrSource: JSHTMLAttrAnalyzer = (name, value) => {
    if(/^on/.test(name)) return "listener";
    if(value == null) return "nullable";
    if(typeof value !== "object")
        return typeof value === "boolean"
            ? "toggle"
            : "string";
    if(["dataset","style"].includes(name))
        return name as "dataset"|"style";
    if(["class","className","classList"].includes(name))
        return "classList";
    return "string";
}

const jshtmlAttrBuilder: JSHTMLAttrBuilder = {
    "nullable": ({target,name}: JSHTMLAttrRuntime<null|undefined>) => {
        target.removeAttribute(name);
    },
    "toggle": ({target,name,value}: JSHTMLAttrRuntime<boolean>) => {
        target.toggleAttribute(name, value);
    },
    "string": ({target,name,value}: JSHTMLAttrRuntime<string>) => {
        target.setAttribute(name, value);
    },
    "listener": ({target,name,value}: JSHTMLAttrRuntime<V_EVENTLISTENER>) => {
        createEventListenerSetter(value as V_EVENTLISTENER, name)(target);
    },
    "classList": ({value,target}:JSHTMLAttrRuntime<V_CLASSLIST>) => {
        if(Array.isArray(value))
            target.className = value.filter(Boolean).join(" ");
        else
            target.className = typeof value === "object"
                ? Object.keys(value).filter((k)=>value[k]).join(" ")
                : value + "";
    },
    "dataset": ({value,target}:JSHTMLAttrRuntime<V_DATASET>) => {
        const dataset = target.dataset;
        if(value == null)
            Object.keys(dataset).forEach((k)=> delete dataset[k]);
        else {
            Object.keys(dataset).filter((k)=>!(k in value)).forEach((k)=>delete dataset[k]);
            Object.entries(value).forEach(([k,v]) => {
                if(isChainedProp<V_STRING>(v)) {
                    bindPropBridge(new DatasetPropBridge(v,target,k));
                    v = v();
                }
                dataset[k] = v != null ? v + "" : '';
            });
        }
    },
    "style": ({value,target}:JSHTMLAttrRuntime<V_STYLE>) => {
        target.removeAttribute("style");
        (Object.entries(value) as [WritableCSSProperty,V_STRING|Prop<V_STRING>][]).forEach(([k,v]) => {
            if(isChainedProp(v)) {
                bindPropBridge(new StylePropBridge(v,target,k));
                v = v();
            }
            setCSSProperty(k, v != null ? v + "": "")(target.style);
        })
    }
}


/**
 * 宣言的なレンダラーを生成する
 * ex.
 * interface SenderContext { send: DripperStream<MouseEvent> }
 * const render = prime(({send}:SenderContext)=>({ a:"send message", $: { onclick: send } }));
 * const sendStream = stream<MouseEvent>();
 * render({ send: ctx });// === HTMLAnchorElement(onclick->collapse(drip(MouseEvent)(sendStream)))
 */ 
const prime = <T extends object>(fn:(v:T)=>JSHTMLNodeSource) => (ctx:T) => jshtml(fn(ctx),ctx);

export {
    defineAttrUpdateHandlers,
    listenerForCollapse,
    promised, jshtml, mutations, prime,
    JSHTMLNodeRuntime,JSHTMLAttrRuntime,
    JSHTML_ELEMENT_HANDLER,
    JSHTML_ATTR_HANDLER 
};
