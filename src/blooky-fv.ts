/**
 * blooky-fv.ts
 * blookyを用いてリアクティブなDOMを構築するライブラリ。
 * blooky-fpのStream/Propの概念をDOMにバインドし、宣言的なHTML記述（JSHTML）を可能にする。
 *
 * Next: fv は fx に直依存せず、FVRuntime（observeCommit/unobserveCommit/submitPlan）を注入して動作する。
 * - DOM Event -> drip -> DripPlan を生成し、runtime.submitPlanへ委譲
 * - commit時の plan 通知は runtime.observeCommit 経由で update(plan) が呼ばれる
 *
 * NOTE: mutations() はコアから排除（削除）。
 */
import type {
  V_DATASET,
  V_STYLE,
  V_CLASSLIST,
  V_EVENTLISTENER,
  V_STRING,
  WritableCSSProperty,
  JSHTMLElementSource,
  JSHTMLAttrSource,
  JSHTMLNodeSource,
  JSHTMLAttributeMapSource,
  JSHTMLAttrRuntime,
  JSHTMLNodeRuntime,
  JSHTMLNodeSourceType,
  JSHTMLExtractedElementSource,
  JSHTMLNodeFactory,
  JSHTMLNodeSourceAnalyzer,
  JSHTMLAttrAnalyzer,
  JSHTMLAttrBuilder,
} from "./blooky-fv-types";

import { isDripper, drip, isChainedProp, stream } from "./blooky-fp";
import type { Prop, Dripper, Stream, DripPlan } from "./blooky-fp-types";

/* ---------------------------------------------
 * FV Runtime Interface (Normative boundary)
 * ------------------------------------------- */

// 観測されたPropとその更新予定の値のMap
export type ObservedDripPlan = Map<Prop<any>,any>;

export interface FVRuntime {

  /**
   * f(plan) を受け取る関数を登録し、Propを監視対象に登録する registerProp を返す。
   * registerProp(p) が呼ばれた Prop に関する commit が発生したとき、onPlan が呼ばれること。
   */
  observeCommit(f: (plan: ObservedDripPlan) => void): (p: Prop<any>) => ()=>void;

  /** observeしたobserve/register の対象から外す */
  unobserveCommit(f: (plan: ObservedDripPlan) => void): (p: Prop<any>) => void;

  /** fv からの「更新計画」を受け取り、適切な境界で commit する（or スケジュールする） */
  submitPlan<A>(plan: DripPlan<A>): Promise<any>;

};

/* ---------------------------------------------
 * Global hooks / symbols
 * ------------------------------------------- */

/**
 * tag指定がjshtmlの仕様に沿わなかった場合に生成される要素の定義。
 */
class JSHTMLUnknownElement extends HTMLElement {}
customElements.define("jshtml-unknown", JSHTMLUnknownElement);

/**
 * カスタム要素をjshtmlで生成する際の独自フックを登録するためのSymbol。
 * カスタム要素クラスの静的プロパティとして使用し、要素生成時の初期化ロジックを提供する。
 */
export const JSHTML_ELEMENT_HANDLER = Symbol("JSHTML_ELEMENT_FACTORY");

/**
 * カスタム要素の独自属性の設定用フックを登録するためのSymbol。
 * カスタム要素クラスの静的プロパティとして使用し、独自の属性処理ロジックを提供する。
 */
export const JSHTML_ATTR_HANDLER = Symbol("JSHTML_ATTR_HANDLER");

/**
 * 属性マップが要素の子ノードの位置に記載された場合、それを属性として扱うためのラッパー。
 * `jshtml({ br: jshtml.$({ class: "clear" }) })` のように、子ノードを持たない要素の属性定義に使用される。
 */
export class EmptyElementAttributeMapSource {
  source: JSHTMLAttributeMapSource;
  constructor(source: JSHTMLAttributeMapSource) {
    this.source = source;
  }
}

/**
 * Promiseの解決を待つ間に表示されるプレースホルダー要素。Promiseが解決すると、生成されたDOMノードに置き換えられる。
 * NOTE: fv-coreとしては Promise をJSHTMLソースとして許容（DOM生成層の都合）。
 */
class PromisedElement extends HTMLElement {
  promise: Promise<JSHTMLNodeSource | Node>;
  constructor(promise: Promise<JSHTMLNodeSource | Node>) {
    super();
    this.promise = promise;
  }
  connectedCallback() {
    if (!this.promise) return;
    this.promise
      .then((n) => {
        const node = n instanceof Node ? n : (this as any)._jshtml(n); // createFVが注入
        this.dispatchEvent(
          new CustomEvent("promise-resolved", {
            bubbles: true,
            detail: { value: node },
          })
        );
        if (this.parentNode) this.parentNode.replaceChild(node, this);
      })
      .catch((error) => {
        if (
          this.dispatchEvent(
            new CustomEvent("promise-rejected", {
              cancelable: true,
              bubbles: true,
              detail: { error },
            })
          )
        )
          throw new Error('"promise-rejected" event is not prevented');
      });
  }
}
customElements.define("blooky-promised-placeholder", PromisedElement);

/* ---------------------------------------------
 * Global attribute handler registry
 * ------------------------------------------- */

const ATTRIBUTE_HANDLER_RREGISTRY: {
  [key: string]: <V>(runtime: JSHTMLAttrRuntime<V>) => boolean | void;
} = Object.create(null);

/**
 * グローバルなカスタム属性更新ハンドラを登録する。
 * 組み込み属性処理や`jshtmlAttrBuilder`の実行前にカスタムロジックを挿入できる。
 * ハンドラが`false`を返した場合、後続の属性処理はスキップされる。
 * @throws 既に登録されている属性ハンドラがある場合
 */
export const defineAttrUpdateHandlers = (handlers: {
  [key: string]: (value: any, target: HTMLElement) => boolean;
}) => {
  const defined = Object.keys(handlers).filter((k) => k in ATTRIBUTE_HANDLER_RREGISTRY);
  if (defined.length) throw new Error(`Attribute handlers already defined: ${defined.join('", "')}`);
  Object.assign(ATTRIBUTE_HANDLER_RREGISTRY, handlers);
};

/* ---------------------------------------------
 * Utilities
 * ------------------------------------------- */

// cssvarへの対応
const setCSSProperty = (n: WritableCSSProperty | string, v: string) => (cssDec: CSSStyleDeclaration) => {
  if (n.startsWith("--")) cssDec.setProperty(n, v);
  else (cssDec as any)[n as WritableCSSProperty] = v;
};

/**
 * JSHTML要素ソースをタグ、属性、子ノードの部品に分割して返す（内部ヘルパー）。
 */
const extractElementSource = (s: JSHTMLElementSource): JSHTMLExtractedElementSource => {
  const tag = Object.keys(s).find((t) => t !== "$");
  if (!tag) {
    console.error("invalid tag name err:", tag);
    return ["jshtml-unknown", null];
  }
  const children = (s as any)[tag] as JSHTMLNodeSource;
  const attrs = "$" in s ? ((s as any).$ as JSHTMLAttributeMapSource) : undefined;
  return !attrs && children instanceof EmptyElementAttributeMapSource
    ? [tag, null, children.source]
    : [tag, children, attrs];
};

/* ---------------------------------------------
 * Factory: createFV(runtime)
 * ------------------------------------------- */

export const createFV = (rt: FVRuntime) => {
  /**
   * PropとDOM要素（ノード、属性、スタイルなど）間の双方向バインディングを管理するインターフェース。
   */
  type PropBridgeInterface<A> = {
    prop: Prop<A>;
    isConnected(): boolean;
    update(next: A, prev: A): void;
    contains(p: PropBridge): boolean;
    toRange(): Range; // contains/GCで必要
  };

  /**
   * PropとDOMのバインド。具体的な実装クラスの共用型。
   */
  type PropBridge = RangePropBridge | AttrPropBridge | StylePropBridge | DatasetPropBridge;

  /**
   * 更新時に参照するため、PropとDOMのバインドを保管するMap
   */
  const PROP_BRIDGE_RECORD = new Map<Prop<any>, PropBridge[]>();

  /**
   * Plan を受けて DOM を更新する（runtime.observeCommit から呼ばれる）
   */
  const update = (plan: ObservedDripPlan) => {

    // DOMに関係するPropを残してガベージコレクト
    const update_target = [...plan.keys()].flatMap((p) => PROP_BRIDGE_RECORD.get(p) || []);

    const isGCTarget = (a: PropBridge) =>
      !a.isConnected() || update_target.some((b) => b.contains(a) && a !== b);

    // ツリーから外れたものと、他のPropに包含されているPropはbindから外す
    PROP_BRIDGE_RECORD.forEach((bridges, prop) => {
      const filtered = bridges.filter((b) => !isGCTarget(b));
      if (!filtered.length) PROP_BRIDGE_RECORD.delete(prop);
      else if (filtered.length < bridges.length) PROP_BRIDGE_RECORD.set(prop, filtered);
    });

    // メモリに残ったbridgeだけでアップデートする
    plan.forEach((next, p) => {
      const bridges = PROP_BRIDGE_RECORD.get(p);
      if (!bridges) {
        rt.unobserveCommit(update)(p);
        return;
      }
      const prev = p() as any;
      if (prev !== next) bridges.forEach((b) => b.update(next, prev));
    });
  };

  /**
   * runtime が返す「このPropを監視対象にする」関数
   */
  const registerProp = rt.observeCommit(update);

  /**
   * PropBridgeを内部レコードに記録する。
   */
  const bindPropBridge = (b: PropBridge) => {
    const p = b.prop;
    const arr = PROP_BRIDGE_RECORD.get(p);
    if (!arr) PROP_BRIDGE_RECORD.set(p, [b]);
    else arr.push(b);
    registerProp(p);
  };

  // aにbが含まれているならtrue
  const containsRange = (a: Range) => (b: Range) => {
    // a の開始 <= b の開始 かつ a の終了 >= b の終了 なら a は b を包含する
    return a.compareBoundaryPoints(Range.START_TO_START, b) <= 0 && a.compareBoundaryPoints(Range.END_TO_END, b) >= 0;
  };

  /**
   * Dripper をDOMイベントリスナーに変換する（実行は runtime.submitPlan に委譲）
   */
const listenerForSubmit =
  <A extends Event>(dripper: Dripper<A>) =>
  (ev: A) => {
    const target = (ev.currentTarget || ev.target) as EventTarget | null;
    if (!target) {
      console.warn("listenerForSubmit: no target available");
      return;
    }

    const plan = { dripper, value: ev };

    // キャンセル可能（fv側の責務）
    const ok = target.dispatchEvent(
      new CustomEvent("blooky-commit-start", {
        cancelable: true,
        bubbles: true,
        detail: { plan, event: ev },
      })
    );

    if (!ok) {
      target.dispatchEvent(
        new CustomEvent("blooky-commit-cancelled", {
          bubbles: true,
          detail: { plan, event: ev },
        })
      );
      return;
    }

    // interface が保証するのは「commit完了のPromise」
    rt.submitPlan(plan)
      .then(() => {
        target.dispatchEvent(
          new CustomEvent("blooky-commit-completed", {
            bubbles: true,
            detail: { plan, event: ev },
          })
        );
      })
      .catch((error) => {
        target.dispatchEvent(
          new CustomEvent("blooky-commit-failed", {
            bubbles: true,
            detail: { plan, event: ev, error },
          })
        );
      });
  };

  /**
   * PropとDOMをRangeでバインドするクラス。
   * 主に `Prop<JSHTMLNodeSource>` の更新時に、DOMノード全体を置き換えるために使用される。
   */
  class RangePropBridge implements PropBridgeInterface<JSHTMLNodeSource> {
    prop: Prop<JSHTMLNodeSource>;
    target: [Node, Node];

    constructor(p: Prop<JSHTMLNodeSource>, t: [Node, Node]) {
      this.prop = p;
      this.target = t;
    }

    toRange() {
      const r = new Range();
      if (this.isSingleNode()) {
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

    update(v: JSHTMLNodeSource, prev: JSHTMLNodeSource) {
      // 通知イベント用に確保
      const previous: [Node, Node] = this.target;
      const n = jshtml(v);

      // 生成したノードを境界のアンカー用ペアとして変数に保存
      let a: Node, b: Node;
      if (n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) a = b = n;
      else if (!n.hasChildNodes()) a = b = n.appendChild(new Comment("[jshtml-placeholder]"));
      else a = n.firstChild!, b = n.lastChild!;

      if (this.isSingleNode()) {
        previous[0].parentNode?.replaceChild(n, previous[0]);
      } else {
        const r = this.toRange();
        r.insertNode(n);
        r.setStartAfter(b);
        r.deleteContents();
        r.detach();
      }

      this.target = [a, b];

      const dispatcher = a === b ? a : a.parentNode!;
      dispatcher.dispatchEvent(
        new CustomEvent("node-prop-update", {
          detail: { prop: this.prop, nextValue: this.target, prevValue: previous },
        })
      );
      return true;
    }

    isConnected() {
      return this.target.every((t) => t.isConnected);
    }

    contains(p: PropBridge) {
      return containsRange(this.toRange())(p.toRange());
    }
  }

  /**
   * PropとDOMを属性でバインドする抽象基底クラス。
   */
  abstract class AbstractAttrPropBridge<A> implements PropBridgeInterface<A> {
    prop: Prop<A>;
    target: HTMLElement;
    name: string;

    constructor(p: Prop<A>, t: HTMLElement, n: string) {
      this.prop = p;
      this.target = t;
      this.name = n;
    }

    abstract update(v: A, prev: A): void;

    toRange() {
      const r = new Range();
      r.selectNode(this.target);
      return r;
    }

    isConnected() {
      return this.target.isConnected;
    }

    contains(_: PropBridge): boolean {
      return false;
    }

    protected dispatchPropUpdateEvent(type: string, nextValue: A, prevValue: A) {
      const { prop, name } = this;
      this.target.dispatchEvent(
        new CustomEvent(type, {
          detail: { prop, name, nextValue, prevValue },
        })
      );
    }
  }

  /**
   * PropとDOMの一般的な属性をバインドするクラス。
   * Dripperの場合、listenerForSubmit で runtime.submitPlan へ委譲する listener を生成する。
   */
  class AttrPropBridge extends AbstractAttrPropBridge<JSHTMLAttrSource> {
    generatedListener?: EventListenerOrEventListenerObject;

    update(next: JSHTMLAttrSource, prev: JSHTMLAttrSource) {
      const { name, target } = this;

      if (this.generatedListener) {
        target.removeEventListener(name.slice(2), this.generatedListener);
        delete this.generatedListener;
      }

      // Dripper または関数を EventListenerObject として設定
      if (isDripper<Event>(next)) {
        next = this.generatedListener = listenerForSubmit(next as any);
      } else if (name.startsWith("on")) {
        this.generatedListener = next as EventListenerOrEventListenerObject;
      }

      const attrType = analyzeAttrSource(name, next);
      jshtmlAttrBuilder[attrType]({ name, target, value: next as any } as any);

      this.dispatchPropUpdateEvent("attr-prop-update", next, prev);
    }

    contains(p: PropBridge) {
      if (!(p instanceof AbstractAttrPropBridge)) return false;
      if (p instanceof AttrPropBridge) return false;
      if (this.target !== (p as any).target) return false;

      return (
        (p instanceof StylePropBridge && this.name === "style") ||
        (p instanceof DatasetPropBridge && this.name === "dataset")
      );
    }
  }

  /**
   * PropとDOMの`style`プロパティ（CSS宣言）をバインドするクラス。
   */
  class StylePropBridge extends AbstractAttrPropBridge<V_STRING> {
    update(v: V_STRING, prev: V_STRING) {
      setCSSProperty(this.name, v != null ? v + "" : "")(this.target.style);
      this.dispatchPropUpdateEvent("style-prop-update", v, prev);
    }
  }

  /**
   * PropとDOMの`dataset`プロパティをバインドするクラス。
   */
  class DatasetPropBridge extends AbstractAttrPropBridge<V_STRING> {
    update(v: V_STRING, prev: V_STRING) {
      (this.target.dataset as any)[this.name] = v == null ? "" : v + "";
      this.dispatchPropUpdateEvent("dataset-prop-update", v, prev);
    }
  }

  // イベントリスナーの設定用関数を生成する
  const createEventListenerSetter =
    (v: V_EVENTLISTENER, n: string) =>
      v && (typeof v === "function" || typeof (v as EventListenerObject).handleEvent === "function")
        ? (e: EventTarget) => e.addEventListener(n.slice(2), v as EventListenerOrEventListenerObject)
        : isDripper<Event>(v)
        ? (e: EventTarget) => e.addEventListener(n.slice(2), listenerForSubmit(v as any))
        : (e: Element) => e.setAttribute(n, v + "");

  /**
   * Promiseが解決するまでプレースホルダーを表示する要素を生成する。
   */
  const promised = (p: Promise<JSHTMLNodeSource | Node>, msg: JSHTMLNodeSource) => {
    const element = new PromisedElement(p);
    // PromisedElement内部でjshtmlを使うため、インスタンスへ注入
    (element as any)._jshtml = jshtml;

    if (msg != null) element.append(jshtml(msg));
    else element.style.display = "none";
    return element;
  };

  /**
   * JSHTMLのノードソースの型を分析する（内部ヘルパー）。
   */
  const analyzeNodeSource: JSHTMLNodeSourceAnalyzer = (s: JSHTMLNodeSource): JSHTMLNodeSourceType => {
    if (s instanceof Node) return "node";
    if (s instanceof Promise) return "promise";
    if (typeof s === "function") return "prop";
    if (Array.isArray(s)) return "array";
    if (s == null || s == undefined) return "nullable";
    if (typeof s !== "object") return "text";
    return "element";
  };

  /**
   * 属性の値の種類を判別する（内部ヘルパー）。
   */
  const analyzeAttrSource: JSHTMLAttrAnalyzer = (name, value) => {
    if (/^on/.test(name)) return "listener";
    if (value == null) return "nullable";
    if (typeof value !== "object")
      return typeof value === "boolean" ? "toggle" : "string";
    if (["dataset", "style"].includes(name)) return name as "dataset" | "style";
    if (["class", "className", "classList"].includes(name)) return "classList";
    return "string";
  };

  /**
   * 属性の種類に応じて、実際のDOM属性を設定するビルダーオブジェクト。
   */
  const jshtmlAttrBuilder: JSHTMLAttrBuilder = {
    nullable: ({ target, name }: JSHTMLAttrRuntime<null | undefined>) => {
      target.removeAttribute(name);
    },
    toggle: ({ target, name, value }: JSHTMLAttrRuntime<boolean>) => {
      target.toggleAttribute(name, value);
    },
    string: ({ target, name, value }: JSHTMLAttrRuntime<string>) => {
      target.setAttribute(name, value);
    },
    listener: ({ target, name, value }: JSHTMLAttrRuntime<V_EVENTLISTENER>) => {
      createEventListenerSetter(value as V_EVENTLISTENER, name)(target);
    },
    classList: ({ value, target }: JSHTMLAttrRuntime<V_CLASSLIST>) => {
      if (Array.isArray(value)) target.className = value.filter(Boolean).join(" ");
      else
        target.className =
          typeof value === "object"
            ? Object.keys(value).filter((k) => (value as any)[k]).join(" ")
            : value + "";
    },
    dataset: ({ value, target }: JSHTMLAttrRuntime<V_DATASET>) => {
      const dataset = target.dataset as any;
      if (value == null) Object.keys(dataset).forEach((k) => delete dataset[k]);
      else {
        Object.keys(dataset).filter((k) => !(k in value)).forEach((k) => delete dataset[k]);
        Object.entries(value).forEach(([k, v]) => {
          if (isChainedProp<V_STRING>(v)) {
            bindPropBridge(new DatasetPropBridge(v as any, target, k));
            v = (v as any)();
          }
          dataset[k] = v != null ? v + "" : "";
        });
      }
    },
    style: ({ value, target }: JSHTMLAttrRuntime<V_STYLE>) => {
      target.removeAttribute("style");
      (Object.entries(value) as [WritableCSSProperty, V_STRING | Prop<V_STRING>][]).forEach(([k, v]) => {
        if (isChainedProp(v)) {
          bindPropBridge(new StylePropBridge(v as any, target, k));
          v = (v as any)();
        }
        setCSSProperty(k, v != null ? v + "" : "")(target.style);
      });
    },
  };

  /**
   * JSHTML形式のソースからDOMノードを生成する。
   * `Prop`が含まれている場合、生成されたノードに`PropBridge`をバインドし、リアクティブな更新を可能にする。
   */
  function jshtml(this: object | void, source: JSHTMLNodeSource, context?: Record<string, any>) {
    const build = (src: JSHTMLNodeSource): Node => {
      const type = analyzeNodeSource(src);
      return nodeFactory[type]({ source: src, build, context: (this || context) as any } as any);
    };
    return build(source);
  }

  /**
   * 属性マップが要素内容に記載されても正常に属性として扱うためのラッパを生成する。空要素用。
   */
  (jshtml as any).$ = (attrs: JSHTMLAttributeMapSource) => new EmptyElementAttributeMapSource(attrs);

  /**
   * JSHTMLのノードソースの種類に応じてDOMノードを生成するファクトリー。
   */
  const nodeFactory: JSHTMLNodeFactory = {
    node: ({ source }: JSHTMLNodeRuntime<Node>) =>
      (source as any).nodeName === "TEMPLATE" ? (source as HTMLTemplateElement).content.cloneNode(true) : source,

    promise: ({ source }: JSHTMLNodeRuntime<Promise<JSHTMLNodeSource>>) => {
      const elm = new PromisedElement(source as any);
      (elm as any)._jshtml = jshtml;
      return elm;
    },

    prop: ({ source, build }: JSHTMLNodeRuntime<Prop<JSHTMLNodeSource>>) => {
      const n = build((source as any)());
      let a: Node, b: Node;

      if (n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        a = b = n;
      } else if (!n.hasChildNodes()) {
        a = b = n.appendChild(new Comment("[jshtml-placeholder]"));
      } else {
        a = n.firstChild!;
        b = n.lastChild!;
      }

      if(isChainedProp(source)) {
        bindPropBridge(new RangePropBridge(source as any, [a, b]));
      }
      return n;
    },

    array: ({ source, build }: JSHTMLNodeRuntime<JSHTMLNodeSource[]>) => {
      const df = new DocumentFragment();
      df.append(...(source as any).map(build));
      return df;
    },

    nullable: (_: JSHTMLNodeRuntime<null | undefined>) => new Comment("jshtml:nullable"),

    text: ({ source }: JSHTMLNodeRuntime<any>) => new Text(source + ""),

    element: (runtime: JSHTMLNodeRuntime<JSHTMLElementSource>) => {
      const { source, build, context } = runtime as any;
      const [tag, children, attributes] = extractElementSource(source);
      const elmClass = customElements.get(tag);
      const elm = document.createElement(tag);

      if (attributes) {
        const customElementAttrHandler =
          elmClass && (JSHTML_ATTR_HANDLER as any) in (elmClass as any)
            ? ((elmClass as any)[JSHTML_ATTR_HANDLER] as {
                [key: string]: (v: JSHTMLAttrRuntime<any>) => boolean | void;
              })
            : {};

        for (const name in attributes) {
          let value = (attributes as any)[name];
          const rtAttr: JSHTMLAttrRuntime<any> = { target: elm as any, name, value, context } as any;

          if (name in customElementAttrHandler && customElementAttrHandler[name](rtAttr) === false) continue;

          // Propの適用
          if (isChainedProp<JSHTMLAttrSource>(value)) {
            bindPropBridge(new AttrPropBridge(value as any, elm, name));
            rtAttr.value = (value as any)(); // 現在値を初期値として使用
            value = rtAttr.value;
          }

          if (!(name in ATTRIBUTE_HANDLER_RREGISTRY) || ATTRIBUTE_HANDLER_RREGISTRY[name](rtAttr) !== false) {
            const kind = analyzeAttrSource(rtAttr.name, rtAttr.value);
            (jshtmlAttrBuilder as any)[kind](rtAttr);
          }
        }
      }

      if (children) {
        (elm.tagName === "TEMPLATE" ? (elm as HTMLTemplateElement).content : elm).append(build(children));
      }

      // カスタム要素のJSHTML_ELEMENT_HANDLERフックを実行
      if (elmClass && (JSHTML_ELEMENT_HANDLER as any) in (elm as any)) (elm as any)[JSHTML_ELEMENT_HANDLER](context);

      return elm;
    },
  };

  /**
   * 宣言的なレンダラーを生成するためのヘルパー関数。
   */
  const prime =
    <T extends object>(fn: (v: T) => JSHTMLNodeSource) =>
    (ctx: T) =>
      jshtml(fn(ctx), ctx);

  // fv-coreの公開API
  return {
    defineAttrUpdateHandlers, // グローバル登録だが利便性のため返す
    listenerForSubmit,
    promised,
    jshtml: jshtml as typeof jshtml & { $: (attrs: JSHTMLAttributeMapSource) => EmptyElementAttributeMapSource },
    prime,
    JSHTML_ELEMENT_HANDLER,
    JSHTML_ATTR_HANDLER,
    // NOTE: stream をfv側で再exportする必要があればここに出す（今は出さない）
  };
};

/* ---------------------------------------------
 * Type re-exports (optional convenience)
 * ------------------------------------------- */

export type {
  JSHTMLAttrRuntime,
  JSHTMLNodeRuntime,
  JSHTMLNodeSource,
  JSHTMLAttrSource,
  JSHTMLElementSource,
  JSHTMLAttributeMapSource,
  JSHTMLNodeSourceType,
  JSHTMLExtractedElementSource,
  JSHTMLNodeFactory,
  JSHTMLNodeSourceAnalyzer,
  JSHTMLAttrAnalyzer,
  JSHTMLAttrBuilder,
  V_DATASET,
  V_STYLE,
  V_CLASSLIST,
  V_EVENTLISTENER,
  V_STRING,
  WritableCSSProperty,
};
