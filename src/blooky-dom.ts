/**
 * blooky-dom.ts
 * blookyを用いてリアクティブなDOMを構築するライブラリ。
 * blooky-fpのStream/Propの概念をDOMにバインドし、宣言的なHTML記述（JSHTML）を可能にする。
 */
import type { V_DATASET, V_STYLE, V_CLASSLIST, V_EVENTLISTENER, V_STRING, WritableCSSProperty, JSHTMLElementSource, JSHTMLAttrSource, JSHTMLNodeSource, JSHTMLAttributeMapSource, JSHTMLAttrRuntime, JSHTMLNodeRuntime, JSHTMLNodeSourceType, JSHTMLExtractedElementSource, JSHTMLNodeFactory, JSHTMLNodeSourceAnalyzer, BlookyMutationEvent, JSHTMLAttrAnalyzer, JSHTMLAttrBuilder } from "./blooky-dom-types";
import { isDripper, drip, isChainedProp, blooky } from "./blooky-fp";
import { stream, collapse, registerCollapseObserver } from "./blooky-ft";
import { Prop, Dripper, Stream, BlookyError, DripStrategy } from "./blooky-types";


/**
 * PropとDOM要素（ノード、属性、スタイルなど）間の双方向バインディングを管理するインターフェース。
 */
type PropBridgeInterface<A> = {
    prop: Prop<A>
    /**
     * DOMの接続状態（ノードがDOMツリー内に存在するか）
     */
    isConnected() : boolean
    /**
     * Propの値の変更をDOMに適用する
     * @param next - 新しい値
     * @param prev - 古い値
     */
    update(next:A,prev:A): void
    /**
     * 別のPropBridgeがこのPropBridgeによって包含されているかを判定する
     * @param p - 判定対象のPropBridge
     */
    contains(p:PropBridge): boolean
}

/**
 * PropとDOMのバインド。具体的な実装クラスの共用型。
 */
type PropBridge = (RangePropBridge | AttrPropBridge | StylePropBridge | DatasetPropBridge);

/**
 * 更新時に参照するため、PropとDOMのバインドを保管するMap
 */
const PROP_BRIDGE_RECORD = new Map<Prop<any>, PropBridge|PropBridge[]>();// 最適化用に共用型

/**
 * PropBridgeを内部レコードに記録する。
 * @param b - 記録するPropBridgeインスタンス
 */
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

/**
 * 判定関数がtrueを返すBridgeをメモリから解放する
 * @param isGCTarget - メモリ解放対象の判定関数
 */
const garbageCollectForBridgeRecords = (isGCTarget: (a:PropBridge) => boolean) => {
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
}

/**
 * Propの変更をDOMに反映させるためのオブザーバーを登録。
 */
registerCollapseObserver("visual", {
    props: PROP_BRIDGE_RECORD,
    handler(effectMap) {
        // DOMに関係するPropを残してガベージコレクト
        const update_target = [...effectMap.keys()].flatMap((p)=>PROP_BRIDGE_RECORD.get(p)||[]);
        // ツリーから外れたものと、他のPropに包含されているPropはbindから外す
        const isGCTarget = (a:PropBridge) => !a.isConnected() || update_target.some((b)=>b.contains(a)&&a!==b);
        garbageCollectForBridgeRecords(isGCTarget);
        // メモリに残ったbridgeだけでアップデートする
        effectMap.forEach((v,p)=>{
            if(!PROP_BRIDGE_RECORD.has(p)) return;
            const prev = p() as any;
            if(prev === v) return;
            const bridge = PROP_BRIDGE_RECORD.get(p)!;
            if(!Array.isArray(bridge)) {
                bridge.update(v,prev);
            } else {
                bridge.forEach((b)=>b.update(v,prev));
            }
        });
    }

});


// aにbが含まれているならtrue
const containsRange = (a: Range) => (b: Range) => {
    // a の開始 <= b の開始 かつ a の終了 >= b の終了 なら a は b を包含する
    return a.compareBoundaryPoints(Range.START_TO_START, b) <= 0
        && a.compareBoundaryPoints(Range.END_TO_END, b) >= 0;
}

/**
 * PropとDOMをRangeでバインドするクラス。主に `Prop<JSHTMLNodeSource>` の更新時に、DOMノード全体を置き換えるために使用される。
 */
class RangePropBridge implements PropBridgeInterface<JSHTMLNodeSource> {
    prop: Prop<JSHTMLNodeSource>
    /**
     * バインドされているDOMノードの開始と終了を指すアンカーノードのペア
     */
    target: [Node, Node];
    constructor(p: Prop<JSHTMLNodeSource>, t: [Node, Node]) { 
        this.prop = p;
        this.target = t;
    }
    /**
     * バインド範囲を示すDOM Rangeオブジェクトを生成する。
     */
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
    /**
     * Propの値の変更に応じてDOMノードを置き換える。
     * @param v - 新しいノードソース
     * @param prev - 古いノードソース
     */
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
    /**
     * バインドされている全てのアンカーノードがDOMに接続されているか。
     */
    isConnected() {
        return this.target.every((t)=>t.isConnected);
    }
    /**
     * このRangeBridgeが別のPropBridgeのDOM範囲を包含するか。
     * @param p - 比較対象のPropBridge
     */
    contains(p:PropBridge) {
        // PropBridgeがRangeBridgeに変換可能であることを前提
        return containsRange(this.toRange())(p.toRange());
    }
}

/**
 * PropとDOMを属性でバインドする抽象基底クラス。
 */
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
    /**
     * バインド範囲を示すDOM Rangeオブジェクトを生成する（ターゲット要素全体）。
     */
    toRange() {
        const r = new Range();
        r.selectNode(this.target);
        return r;
    }
    /**
     * ターゲット要素がDOMに接続されているか。
     */
    isConnected() {
        return this.target.isConnected;
    }
    /**
     * 属性Bridgeは、通常は他のBridgeを包含しない。
     * @param p - 比較対象のPropBridge
     */
    contains(p: PropBridge): boolean {
        return false; // 属性は特殊な例を除いて他のbridgeを包含しない
    }
    /**
     * 属性更新イベントをDOMにディスパッチする。
     */
    protected dispatchPropUpdateEvent(type: string, nextValue:A, prevValue:A) {
        const {prop,name} = this;
        this.target.dispatchEvent(new CustomEvent(type, {
            detail: { prop, name, nextValue, prevValue }
        }));
    }
}

/**
 * PropとDOMの一般的な属性（`href`, `value`, `onclick`など）をバインドするクラス。
 * イベントリスナー（`on*`）属性の場合、`Dripper`を`listenerForCollapse`でラップして適用する。
 */
class AttrPropBridge extends AbstractAttrPropBridge<JSHTMLAttrSource> {
    generatedListener?: EventListenerOrEventListenerObject
    /**
     * Propの値の変更に応じて属性を更新する。
     * Dripperの場合、`listenerForCollapse`に変換してEventListenerとして設定する。
     * @param next - 新しい値
     * @param prev - 古い値
     */
    update(next: JSHTMLAttrSource, prev: JSHTMLAttrSource){
        const {name,target} = this;
        if(this.generatedListener) {
            target.removeEventListener(name.slice(2), this.generatedListener);
            delete this.generatedListener;
        }
        // Dripperまたは関数をEventListenerObjectとして設定
        if(isDripper<Event>(next))
            next = this.generatedListener = listenerForCollapse(next);
        else if(name.startsWith("on"))
            this.generatedListener = next as EventListenerOrEventListenerObject;
        const attrType = analyzeAttrSource(name, next);
        jshtmlAttrBuilder[attrType]({ name, target, value: next as any });
        this.dispatchPropUpdateEvent("attr-prop-update", next, prev);
    }
    /**
     * `style`属性のAttrPropBridgeは`StylePropBridge`を、`dataset`属性のAttrPropBridgeは`DatasetPropBridge`を包含する。
     * @param p - 比較対象のPropBridge
     */
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

/**
 * PropとDOMの`style`プロパティ（CSS宣言）をバインドするクラス。個々のCSSプロパティの更新に使用される。
 */
class StylePropBridge extends AbstractAttrPropBridge<V_STRING> {
    /**
     * Propの値の変更に応じてCSSプロパティを更新する。
     * @param v - 新しい値
     * @param prev - 古い値
     */
    update(v: V_STRING, prev: V_STRING) {
        setCSSProperty(this.name, v != null ? v + "" : "")(this.target.style);
        this.dispatchPropUpdateEvent("style-prop-update", v, prev);
    }
}

/**
 * PropとDOMの`dataset`プロパティをバインドするクラス。個々のデータ属性の更新に使用される。
 */
class DatasetPropBridge extends AbstractAttrPropBridge<V_STRING> {
    /**
     * Propの値の変更に応じてデータ属性を更新する。
     * @param v - 新しい値
     * @param prev - 古い値
     */
    update(v: V_STRING, prev: V_STRING) {
        this.target.dataset[this.name] = v == null ? "" : v+"";
        this.dispatchPropUpdateEvent("dataset-prop-update",v,prev);
    }
}

/**
 * `Dripper`を通常のDOMイベントリスナーに変換する。
 * イベント発生時に`drip`で`DripEffect`を生成し、`collapse`を呼び出す。
 * また、`blooky-collapse-*` イベントを発火させることで、外部から実行の制御や監視を可能にする。
 * * @param d - 値を流し込むDripper
 * @returns DOMイベントリスナー関数
 */
const listenerForCollapse = <A extends Event>(d: Dripper<A>) => (v: A) => {
    const target = v.currentTarget || v.target;
    if (!target) {
        console.warn('listenerForCollapse: no target available');
        return;
    }
    const dripEffect = drip(v)(d);
    // blooky-collapse-startイベントでキャンセル可能
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

// DOMイベントの同期的処理のオプション。dripStrategy拡張
type InterceptOptions = Partial<{
    preventDefault: boolean
    stopPropagation: boolean
    stopImmediatePropagation: boolean
}>;

/**
 * DOMイベントを処理するための`Dripper`を生成する。
 * dripStrategyを拡張した引数を受け取り、`preventDefault`などの呼び出しを可能にした上で、
 * EventListenerとして使用可能なDripperを生成する。
 * @param strategy - blookyの実行戦略とイベント伝播制御オプション
 * @returns イベントリスナーとして使用可能なDripper
 */
const eventDripper = <E extends Event>(strategy?: DripStrategy & InterceptOptions): Dripper<E> & EventListenerObject => {
    const dripper = stream<E>(strategy);
    return Object.assign(dripper, {
        handleEvent(e: E) {
            if(strategy.preventDefault) e.preventDefault();
            if(strategy.stopImmediatePropagation) e.stopImmediatePropagation();
            else if(strategy.stopPropagation) e.stopPropagation();
            listenerForCollapse(dripper)(e);
        }
    })
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
        v && (typeof v === "function" || typeof (v as EventListenerObject).handleEvent === "function")
        ? (e:EventTarget) => e.addEventListener(n.slice(2), v as EventListenerOrEventListenerObject)
        : isDripper<Event>(v)
        ? (e:EventTarget) => e.addEventListener(n.slice(2), listenerForCollapse(v))
        : (e:Element) => e.setAttribute(n,v+"");

/**
 * JSHTML要素ソースをタグ、属性、子ノードの部品に分割して返す（内部ヘルパー）。
 * @param s - JSHTML要素ソース
 * @returns [タグ名, 子ノードソース, 属性マップソース] のタプル
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

/**
 * グローバルなカスタム属性更新ハンドラを登録する。
 * 組み込み属性処理や`jshtmlAttrBuilder`の実行前にカスタムロジックを挿入できる。
 * ハンドラが`false`を返した場合、後続の属性処理はスキップされる。
 * * @param handlers - `{ 属性名: (value, target) => boolean|void }` 形式のハンドラマップ
 * @throws 既に登録されている属性ハンドラがある場合、`blooky.error`を発火
 */
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

/**
 * Promiseの解決を待つ間に表示されるプレースホルダー要素。Promiseが解決すると、生成されたDOMノードに置き換えられる。
 */
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

/**
 * Promiseが解決するまでプレースホルダーを表示する要素を生成する。
 * @param p - DOMノードまたはJSHTMLノードソースを返すPromise
 * @param msg - プレースホルダーとして表示するノードソース（省略時は非表示のプレースホルダー）
 * @returns PromisedElement
 */
const promised = (p: Promise<JSHTMLNodeSource|Node>, msg: JSHTMLNodeSource) => {
    const element = new PromisedElement(p);
    if(msg != null)
        element.append(jshtml(msg));
    else
        element.style.display = "none";
    return element;
}

/**
 * 属性マップが要素の子ノードの位置に記載された場合、それを属性として扱うためのラッパー。
 * `jshtml({ br: jshtml.$({ class: "clear" }) })` のように、子ノードを持たない要素の属性定義に使用される。
 */
export class EmptyElementAttributeMapSource {
    source: JSHTMLAttributeMapSource
    constructor(source:JSHTMLAttributeMapSource){
        this.source = source;
    }
}

/**
 * MutationObserverを介して、DOMの変異をイベントストリームに接続する。
 * @param init - MutationObserverの初期設定
 * @returns Nodeを受け取り、変異を流すStreamを返す関数
 */
const mutations = (init: MutationObserverInit) => (n: Node) : Stream<BlookyMutationEvent> => {
    const s = stream<BlookyMutationEvent>();
    const l = listenerForCollapse(s);
    const o = new MutationObserver((records, observer)=>{
        // カスタムイベントでキャンセル可能
        if(n.dispatchEvent(new CustomEvent("blooky-observe-mutations", {
            bubbles: true,
            cancelable: true,
            detail: { records, observer }
        }))) return;
        // イベントがキャンセルされた場合、Observerを停止し、リスナーを解除する
        observer.disconnect();
        n.removeEventListener("blooky-observe-mutations", l as EventListener);
    });
    n.addEventListener("blooky-observe-mutations", l as EventListener);
    o.observe(n, init);
    return s;
};

/**
 * カスタム要素をjshtmlで生成する際の独自フックを登録するためのSymbol。
 * カスタム要素クラスの静的プロパティとして使用し、要素生成時の初期化ロジックを提供する。
 */
const JSHTML_ELEMENT_HANDLER = Symbol("JSHTML_ELEMENT_FACTORY");
/**
 * カスタム要素の独自属性の設定用フックを登録するためのSymbol。
 * カスタム要素クラスの静的プロパティとして使用し、独自の属性処理ロジックを提供する。
 * `{ [属性名]: (v:JSHTMLAttrRuntime<any>)=>boolean|void }` 形式で定義される。
 */
const JSHTML_ATTR_HANDLER = Symbol("JSHTML_ATTR_HANDLER");

/**
 * JSHTML形式のソースからDOMノードを生成する。
 * `Prop`が含まれている場合、生成されたノードに`PropBridge`をバインドし、リアクティブな更新を可能にする。
 * @param source - JSHTMLノードソース
 * @param context - 要素生成時に利用可能なコンテキストオブジェクト
 * @returns 生成されたDOMノードまたはDocumentFragment
 */
function jshtml(this: object|void, source: JSHTMLNodeSource, context?: Record<string,any>) {
    const build = (source: JSHTMLNodeSource) : Node => {
        const type = analyzeNodeSource(source);
        // build関数はcontextをthisとして継承しつつ再帰的に呼び出される
        return nodeFactory[type]({ source, build, context: this || context } as JSHTMLNodeRuntime<any>);
    };
    return build(source);
}

/**
 * 属性マップが要素内容に記載されても正常に属性として扱うためのラッパを生成する。空要素用。
 * @param attrs - 属性マップ
 * @returns EmptyElementAttributeMapSourceインスタンス
 */
jshtml.$ = (attrs: JSHTMLAttributeMapSource) => new EmptyElementAttributeMapSource(attrs);

/**
 * JSHTMLのノードソースの型を分析する（内部ヘルパー）。
 * @param s - JSHTMLノードソース
 * @returns ノードソースの種類
 */
const analyzeNodeSource: JSHTMLNodeSourceAnalyzer = (s: JSHTMLNodeSource): JSHTMLNodeSourceType => {
    if(s instanceof Node) return "node";
    if(s instanceof Promise) return "promise";
    if(typeof s === "function") return "prop";
    if(Array.isArray(s)) return "array";
    if(s == null || s == undefined) return "nullable";
    if(typeof s !== "object") return "text";
    return "element";
}

/**
 * JSHTMLのノードソースの種類に応じてDOMノードを生成するファクトリー。
 */
const nodeFactory: JSHTMLNodeFactory = {
    "node": ({source}:JSHTMLNodeRuntime<Node>) => source.nodeName === "TEMPLATE" ? (source as HTMLTemplateElement).content.cloneNode(true) : source,
    "promise": ({source}:JSHTMLNodeRuntime<Promise<JSHTMLNodeSource>>) => new PromisedElement(source),
    "prop": ({source,build}:JSHTMLNodeRuntime<Prop<JSHTMLNodeSource>>) => {
        const n = build(source());
        let a: Node, b: Node;
        // Propで置き換え可能な範囲を特定するためのアンカーノードを設定
        if(n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
            a = b = n;
        } else if(!n.hasChildNodes()) {
            a = b = n.appendChild(new Comment("[jshtml-placeholder]"));
        } else {
            a = n.firstChild!, b = n.lastChild!;
        }
        // RangePropBridgeをバインドして、Propの更新がノードの置き換えに繋がるようにする
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
                    continue; // カスタムハンドラがfalseを返したら、後続の処理はしない
                // Propの適用: Propが含まれる場合、AttrPropBridgeをバインドする
                if(isChainedProp<JSHTMLAttrSource>(value)) {
                    bindPropBridge(new AttrPropBridge(value, elm, name));
                    runtime.value = value(); // 現在値を初期値として使用
                }
                if(!(name in ATTRIBUTE_HANDLER_RREGISTRY) || ATTRIBUTE_HANDLER_RREGISTRY[name](runtime) !== false)
                    jshtmlAttrBuilder[analyzeAttrSource(runtime.name,runtime.value)](runtime);
            }
        }
        if(children)
            elm.append(build(children));
        // カスタム要素のJSHTML_ELEMENT_HANDLERフックを実行
        if(elmClass && JSHTML_ELEMENT_HANDLER in elm)
            (elm[JSHTML_ELEMENT_HANDLER] as Function)(context);
        return elm;
    },
}

/**
 * 属性の値の種類を判別する（内部ヘルパー）。
 * @param name - 属性名
 * @param value - 属性値ソース
 * @returns 属性の種類
 */
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

/**
 * 属性の種類に応じて、実際のDOM属性を設定するビルダーオブジェクト。
 */
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
                // Propが含まれる場合、DatasetPropBridgeをバインドする
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
            // Propが含まれる場合、StylePropBridgeをバインドする
            if(isChainedProp(v)) {
                bindPropBridge(new StylePropBridge(v,target,k));
                v = v();
            }
            setCSSProperty(k, v != null ? v + "": "")(target.style);
        })
    }
}


/**
 * 宣言的なレンダラーを生成するためのヘルパー関数。
 * レンダリングロジックと外部コンテキストを分離し、コンポーネント的な記述を可能にする。
 * @param fn - コンテキストオブジェクトを受け取り、JSHTMLノードソースを返す関数
 * @returns コンテキストオブジェクトを受け取り、DOMノードを返す関数
 * @example
 * ```typescript
 * // コンテキスト定義
 * interface SenderContext { send$: Dripper<MouseEvent> }
 * // レンダラー定義
 * const renderButton = prime(({ send$ }: SenderContext) => ({
 *  button: "Send Message",
 *  $: { onclick: send$ } // Dripperがイベントリスナーとして設定される
 * }));
 * // 利用
 * const sendStream = stream<MouseEvent>();
 * const dom = renderButton({ send$: sendStream });
 * document.body.appendChild(dom);
 * ```
 */ 
const prime = <T extends object>(fn:(v:T)=>JSHTMLNodeSource) => (ctx:T) => jshtml(fn(ctx),ctx);

export {
    defineAttrUpdateHandlers,
    listenerForCollapse, eventDripper,
    promised, jshtml,mutations, prime,
    JSHTMLNodeRuntime,JSHTMLAttrRuntime,
    JSHTML_ELEMENT_HANDLER,
    JSHTML_ATTR_HANDLER 
};