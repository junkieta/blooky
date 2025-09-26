import { jshtml, JSHTML_ATTR_HANDLER, JSHTML_ELEMENT_HANDLER, JSHTMLAttrRuntime, JSHTMLNodeRuntime } from "./blooky-dom";
import { blooky } from "./blooky-fp";
import { 
  prepare, 
  execute, 
  fx, 
  ref,
  FxRef
} from "./blooky-fx";
import { CollapseObserver, DripperStream } from "./blooky-types";
import { FxNode, ExecContext, PreparedFx, ExecutionHandle, AppContext } from "./fx/types";

// ---- Abstract Base ----

export abstract class EffectElement extends HTMLElement {

  abstract toFxNode(): FxNode;

  protected childrenToFxNodes(): FxNode[] {
    return Array.from(this.children)
      .filter((n): n is EffectElement => n instanceof EffectElement)
      .map((n) => n.toFxNode());
  }
}

// ---- Context Binding ----

const CONTEXT_MEMO = new WeakMap<AppContext,AppContext>();

const reverseLookup = (value: unknown) => (ctx: AppContext) => {
  if(!CONTEXT_MEMO.has(ctx)) CONTEXT_MEMO.set(ctx, new Map(Object.entries(ctx).map(([k,v])=>[v,k])));
  const reversed = CONTEXT_MEMO.get(ctx)!;
  return reversed.has(value) ? reversed.get(value) : null;
}

// jshtmlでコンテキストから属性に直接マッピングされていた場合、属性値にはコンテキストのキーを用いる
const attrValueToContextKey = ({target,name,value,context}: JSHTMLAttrRuntime<any>): boolean | void => {
  if(!context) return true;
  const context_key = reverseLookup(value)(context);
  if(!context_key) return true;
  target.setAttribute(name, context_key);
  return false;
};

// ---- Core Elements----

class FxSequenceElement extends EffectElement {
  toFxNode(): FxNode {
    return fx.sequence(this.childrenToFxNodes());
  }
}

class FxParallelElement extends EffectElement {
  toFxNode(): FxNode {
    return fx.parallel(this.childrenToFxNodes());
  }
}
class FxRaceElement extends EffectElement {
  toFxNode(): FxNode {
    return fx.race(this.childrenToFxNodes());
  }
}


class FxWaitElement extends EffectElement {

  static [JSHTML_ATTR_HANDLER] = { until: attrValueToContextKey }

  toFxNode(): FxNode {
    const msAttr = this.getAttribute("ms");
    let ms : FxRef<number>;
    if(!msAttr)
      ms = () => 0;
    else if(!isNaN(parseInt(msAttr)))
      ms = () => parseInt(msAttr);
    else
      ms = ref<number>(msAttr);
    // 属性値をそのまま渡す。数値かrefかはprepareが解決する
    const until = this.hasAttribute("until") ? ref<boolean>(this.getAttribute("until")!) : undefined;
    return fx.wait({ms,until,id:this.id});
  }
}

class FxCallElement extends EffectElement {

  static [JSHTML_ATTR_HANDLER] = { fn: attrValueToContextKey, arg: attrValueToContextKey }

  toFxNode(): FxNode {
    const fnAttr = this.getAttribute("fn");
    if (!fnAttr) return fx.none();

    let arg: FxRef<any> = undefined;
    if(this.hasAttribute("arg")) {
      arg = ref(this.getAttribute("arg")!);
    } else if(/\S/.test(this.textContent)) {
      arg = () => JSON.parse(this.textContent.trim())
    }
    
    return fx.call(ref(fnAttr), {
      arg: arg,
      catcher: this.hasAttribute("catcher") ? ref(this.getAttribute("catcher")!) : undefined,
      id: this.id,
    });
  }
}

/**
 * 読み込んだフローのDOMテンプレートをキャッシュするためのMap
 * string: JSONファイルのsrc
 * HTMLTemplateElement: パース済みのDOMフラグメントを保持するtemplate要素
 */
const FLOW_TEMPLATE_CACHE = new Map<string, HTMLTemplateElement>();

class FxIncludeElement extends EffectElement { // FxFlowからFxIncludeにリネーム

  // 'src'属性の変更を監視対象に含める
  static observedAttributes = ['src'];
  
  toFxNode(): FxNode {
    const children = this.childrenToFxNodes();
    const node = children.length > 1
      ? fx.sequence(children)
      : children[0] ?? fx.none();
    return this.id ? { ...node, id: this.id } : node;
  }

  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.innerHTML = `<slot></slot>`;
    this.updateContent(); // 内部メソッドを呼び出す
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    // src属性が変更され、かつ新しい値がセットされた場合にのみ更新
    if (name === 'src' && oldValue !== newValue) {
      this.updateContent(); // 内部メソッドを呼び出す
    }
  }
  
  /**
   * src属性に基づいて、要素の内容を更新する内部メソッド
   */
  private async updateContent() {
    const src = this.getAttribute("src");
    if (!src) {
      this.replaceChildren(); // srcがなければ内容を空にする
      return;
    }

    const useCache = this.getAttribute("cache") !== "no";

    let template = FLOW_TEMPLATE_CACHE.get(src);
    if (!template || !useCache) {
      try {
        const response = await fetch(src, { headers: { Accept: "application/json" } });
        if (!response.ok) throw blooky.error("user", {
          code: "FETCH_FAILED_ERROR",
          message: `Fetch failed:"${response.url}"`,
          element: this,
          originalError: new Error(response.statusText)
        });
        template = this.ownerDocument.createElement("template") as HTMLTemplateElement;
        template.content.append(jshtml(await response.json()));
        FLOW_TEMPLATE_CACHE.set(src, template);
      } catch (error) {
        console.error(`Error processing include from "${src}":`, error);
        this.replaceChildren(); // エラー時も内容を空にする
        return;
      }
    }

    const clonedContent = template.content.cloneNode(true);
    this.replaceChildren(clonedContent);
  }
}


class FxIfElement extends EffectElement {
  static [JSHTML_ATTR_HANDLER] = { when: attrValueToContextKey }
  toFxNode(): FxNode {
    const whenAttr = this.getAttribute("when");
    if (!whenAttr) return fx.none();

    const thenNode = this.querySelector('[slot="then"]') as EffectElement | null;
    const elseNode = this.querySelector('[slot="else"]') as EffectElement | null;
    
    // when属性をrefとして渡すだけ
    const condRef = ref<boolean>(whenAttr);

    if (thenNode) {
      return fx.condition(condRef, thenNode.toFxNode(), elseNode?.toFxNode());
    } else {
      const childrenFx = this.childrenToFxNodes();
      return fx.condition(condRef, childrenFx.length ? fx.sequence(childrenFx) : fx.none());
    }
  }
}

class FxSwitchElement extends EffectElement {
  static [JSHTML_ATTR_HANDLER] = { by: attrValueToContextKey }
  toFxNode(): FxNode {
    const byAttr = this.getAttribute("by");
    if (!byAttr) return fx.none();

    const cases = new Map(
      Array.from(this.children)
        .filter((e): e is EffectElement => e instanceof EffectElement && e.hasAttribute("slot"))
        .map(e => [e.getAttribute("slot")!, e.toFxNode()])
    );
    
    const defaultNode = cases.get("default");
    cases.delete("default");

    return fx.switch(ref(byAttr), cases, defaultNode);
  }
}

class FxLoopElement extends EffectElement {
  static [JSHTML_ATTR_HANDLER] = { while: attrValueToContextKey }

  toFxNode(): FxNode {
    const whileAttr = this.getAttribute("while");
    if (!whileAttr) return fx.none();
    
    const options: {
      maxIterations?: number;
      maxDuration?: number;
    } = {};
    // max-iterations
    const maxIterAttr = this.getAttribute("max-iterations");
    if (maxIterAttr === "infinity") {
      options.maxIterations = Infinity;
    } else if (maxIterAttr) {
      const num = parseInt(maxIterAttr);
      if (!isNaN(num) && num > 0) options.maxIterations = num;
    }
    
    // max-duration
    const maxDurAttr = this.getAttribute("max-duration");
    if (maxDurAttr) {
      const num = parseInt(maxDurAttr);
      if (!isNaN(num) && num > 0) options.maxDuration = num;
    }
    
    return fx.loop(ref<boolean>(whileAttr), fx.sequence(this.childrenToFxNodes()), options);
  }

}

class FxCollapseElement extends EffectElement {
  static [JSHTML_ATTR_HANDLER] = { dripper: attrValueToContextKey, value: attrValueToContextKey }
  toFxNode(): FxNode {
    const streamKey = this.getAttribute("dripper");
    if (!streamKey) return fx.none();

    const valueKey = this.getAttribute("value");
    if(valueKey) return fx.collapse(ref<any>(valueKey), ref<DripperStream<any>>(streamKey));

    let data: any;
    const raw = this.textContent.trim();
    try {
      data = JSON.parse(raw);
    } catch(err) {
      data = raw.length ? raw : undefined;
    }
    return fx.collapse(data, ref<DripperStream<any>>(streamKey));
  }
}


class FxYieldElement extends EffectElement {
  static [JSHTML_ATTR_HANDLER] = { for: attrValueToContextKey }
  toFxNode(): FxNode {
    const id = this.id;
    const forAttr = this.getAttribute("for");
    if (!forAttr) {
      console.error("<fx-yield> requires an 'for' attribute.");
      return fx.none();
    }
    let value: undefined | FxRef<any> = undefined;
    if(this.hasAttribute("value")) {
      value = ref(this.getAttribute("value")!);
    } else if(/\S/.test(this.textContent)) {
      value = () => JSON.parse(this.textContent.trim());
    }
    return fx.yield({ for: ref<string>(forAttr), value, id });
  }
}

class FxReturnElement extends EffectElement {
  static [JSHTML_ATTR_HANDLER] = { value: attrValueToContextKey }
  toFxNode(): FxNode {
    return fx.return(this.hasAttribute("value") ? ref(this.getAttribute("value")!) : undefined);
  }
}

class FxContextElement extends EffectElement {

  static noneResult = Symbol("none")

  protected context: Record<string, any> = {};
  
  parentContext() : FxContextElement | null {
    return this.parentElement ? this.parentElement.closest("fx-context,fx-effect") : null;
  }

  toFxNode(): FxNode {
    const nodes = this.childrenToFxNodes();
    const child = !nodes.length
      ? fx.none() 
      : nodes.length === 1
      ? nodes[0]
      : fx.sequence(nodes);
    return fx.context(this.context, child, this.id);
  }

  // use属性値を最低限必要なキーとして使う
  setContext(ctx: Record<string, any>) {
    if(this.hasAttribute("use")) {
      const useAttr = this.getAttribute("use")!;
      const useList = useAttr.replace(/\s+/g,"").split(",");
      const noExist = useList.filter((use)=>!(use in ctx));
      if(noExist.length)
        throw new Error(`[fx-context] Invalid context: "${noExist.join()}" is not contained`);
    }
    this.context = ctx;
  }

  // use属性値をホワイトリストとして利用
  containedUseAttr(key: string) {
    if(!this.hasAttribute("use")) return false;
    const useAttr = this.getAttribute("use")!;
    if(useAttr === "*") return true;
    const useList = useAttr.replace(/\s+/g,"").split(",");
    return useList && useList.includes(key);
  }

    // 自分からルートまで値を検索する
  getContextValue(key: string, requiredUseAttr = false) : unknown {
    // 1. まず自分のコンテキストを確認
    if (key in this.context) {
      if(requiredUseAttr === true && !this.containedUseAttr(key)) {
        throw new Error(`[fx-context] Invalid context key: "${key}" is not contained "use" attribute.`);
      }
      return this.context[key];
    }
    // 2. なければ、親コンテキストに問い合わせる
    const parent = this.parentContext();
    if (parent) {
      return parent.getContextValue(key, requiredUseAttr); // 親に対して同じ関数を再帰的に呼び出す
    }
    // 3. 親がいなければ（ルートまで到達）、undefinedを返す
    return undefined;
  }
  
}

class FxEffectElement extends FxContextElement {

  static observedAttributes = ["ignite"];

  protected _execContext?: Partial<ExecContext>
  protected _preparedFx?: PreparedFx
  protected _handle?: ExecutionHandle

  [JSHTML_ELEMENT_HANDLER](context?: AppContext) {
    if(context) this.setContext(context);
  }

  prepare(force = false) {
    if (!force && this._preparedFx) return this._preparedFx;
    return this._preparedFx = prepare(this.toFxNode(), this.context, this._execContext);
  }

  execute() {
    if(this._handle) this._handle.cancel();
    this._handle = execute(this._preparedFx || this.prepare());
    return this._handle;
  }

  protected igniteFx(type: CollapseObserver | "none") {
    switch(type) {
      case "none":
        break;

      case "quantum":
        queueMicrotask(this.execute.bind(this));
        break;

      case "visual":
        requestAnimationFrame(this.execute.bind(this));
        break;

      case "sequential":
        setTimeout(this.execute.bind(this));
        break;

      case "immediate":
        this.execute();
        break;

      default:
        console.warn(`unknown ignite attr value: "${this.getAttribute("ignite")}"`);
        this.execute();
        break;
    }
  }

  connectedCallback() {
    this.igniteFx(!this.hasAttribute("ignite") ? "quantum" : this.getAttribute("ignite") as CollapseObserver | "none");
  }

  disconnectedCallback() {
    this._handle?.cancel();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if(newValue === oldValue || name !== "ignite" || !this.isConnected) return;
    this._handle?.cancel();
    if(newValue && newValue !== "none") this.igniteFx(newValue as CollapseObserver);
  }

}

const fxdom = {

  defineEffectElements: (tagNameMap: Record<string,typeof EffectElement> = EffectElementTagNameMap) => {
    // 引数でEffectElementに縛るため、defineはasで通す
    Object.entries(tagNameMap).forEach(([tag,cls])=>{
      if (customElements.get(tag)) {
          throw new Error(`Custom element "${tag}" is already defined`);
      }
      customElements.define(tag,cls as unknown as CustomElementConstructor)
    });
  }

}

const EffectElementTagNameMap = {
  "fx-sequence": FxSequenceElement,
  "fx-parallel": FxParallelElement,
  "fx-race":  FxRaceElement,
  "fx-wait":  FxWaitElement,
  "fx-call":  FxCallElement,
  "fx-include":  FxIncludeElement,
  "fx-if":  FxIfElement,
  "fx-switch":  FxSwitchElement,
  "fx-loop":  FxLoopElement,
  "fx-collapse":  FxCollapseElement,
  "fx-yield": FxYieldElement,
  "fx-context":  FxContextElement,
  "fx-effect":  FxEffectElement,
  "fx-return": FxReturnElement
}

export {FxCallElement,FxWaitElement,FxEffectElement,FxCollapseElement,FxIfElement,FxIncludeElement,FxParallelElement,FxRaceElement,FxLoopElement,FxSequenceElement,FxSwitchElement,FxContextElement,FxReturnElement,fxdom,EffectElementTagNameMap};
