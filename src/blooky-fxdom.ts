import { DripperStream, isDripperStream, isStream, type Prop, type Stream } from "./blooky";
import { jshtml } from "./blooky-dom";
import { 
  createCancelToken, 
  prepare, 
  execute, 
  fx, 
  ref, // ★
  type FxMiddleware, 
  type FxDispatchSettings, 
  type FxNode,
  type AppContext,
  type ExecContext,
  type PreparedFx,
  ExecutionHandle,
  FxRef
} from "./blooky-fx";

// ---- Abstract Base ----

export abstract class EffectElement extends HTMLElement {
  abstract toFxNode(): FxNode;

  protected childrenToFxNodes(): FxNode[] {
    return Array.from(this.children)
      .filter((n): n is EffectElement => n instanceof EffectElement)
      .map((n) => n.toFxNode());
  }
}

// ---- Core Elements (リファクタリング後) ----

class FxSequence extends EffectElement {
  toFxNode(): FxNode {
    return fx.sequence(this.childrenToFxNodes());
  }
}
class FxParallel extends EffectElement {
  toFxNode(): FxNode {
    return fx.parallel(this.childrenToFxNodes());
  }
}
class FxRace extends EffectElement {
  toFxNode(): FxNode {
    return fx.race(this.childrenToFxNodes());
  }
}
// ... FxParallel, FxRace は変更なし ...

class FxWait extends EffectElement {
  toFxNode(): FxNode {
    // 属性値をそのまま渡す。数値かrefかはprepareが解決する
    const msAttr = this.getAttribute("ms") || "0";
    const ms = Number.isNaN(parseInt(msAttr, 10)) ? ref<number>(msAttr) : parseInt(msAttr, 10);
    return fx.wait(ms);
  }
}

class FxCall extends EffectElement {
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
const flowTemplateCache = new Map<string, HTMLTemplateElement>();


class FxInclude extends EffectElement { // FxFlowからFxIncludeにリネーム

  // 'src'属性の変更を監視対象に含める
  static get observedAttributes() {
    return ['src'];
  }
  
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
    this._updateContent(); // 内部メソッドを呼び出す
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    // src属性が変更され、かつ新しい値がセットされた場合にのみ更新
    if (name === 'src' && oldValue !== newValue) {
      this._updateContent(); // 内部メソッドを呼び出す
    }
  }
  
  /**
   * src属性に基づいて、要素の内容を更新する内部メソッド
   */
  private async _updateContent() {
    const src = this.getAttribute("src");
    if (!src) {
      this.replaceChildren(); // srcがなければ内容を空にする
      return;
    }

    let template = flowTemplateCache.get(src);
    if (!template) {
      try {
        const response = await fetch(src, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
        template = jshtml({ template: await response.json() }) as HTMLTemplateElement;
        flowTemplateCache.set(src, template);
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


class FxIf extends EffectElement {
  toFxNode(): FxNode {
    const whenAttr = this.getAttribute("when");
    if (!whenAttr) return fx.none();

    const thenNode = this.querySelector('[slot="then"]') as EffectElement | null;
    const elseNode = this.querySelector('[slot="else"]') as EffectElement | null;
    
    // ★ when属性をrefとして渡すだけ
    const condRef = ref<boolean>(whenAttr);

    if (thenNode) {
      return fx.condition(condRef, thenNode.toFxNode(), elseNode?.toFxNode());
    } else {
      const childrenFx = this.childrenToFxNodes();
      return fx.condition(condRef, childrenFx.length ? fx.sequence(childrenFx) : fx.none());
    }
  }
}

class FxSwitch extends EffectElement {
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

    // ★ by属性をrefとして渡すだけ
    return fx.switch(ref(byAttr), cases, defaultNode);
  }
}

class FxLoop extends EffectElement {
    toFxNode(): FxNode {
        const whileAttr = this.getAttribute("while");
        if (!whileAttr) return fx.none();
        
        // ★ while属性をrefとして渡すだけ
        return fx.loop(ref(whileAttr), fx.sequence(this.childrenToFxNodes()));
    }
}

class FxDispatch extends EffectElement {
  
  toFxNode(): FxNode {
    const name = this.getAttribute("name");
    if (!name) return fx.none();

    const detail : FxRef<unknown> = this.hasAttribute("detail")
      ? ref(this.getAttribute("detail")!)
      : undefined;

    const target_attr = this.getAttribute("target") || "_self";
    const target = target_attr === "_self" ? this : target_attr;
    const settings: FxDispatchSettings<any> = {
      target,
      detail,
      bubbles: this.getAttribute("bubbles") !== "none",
      composed: this.getAttribute("composed") !== "none",
      cancelable: this.hasAttribute("cancelable")
    };
    const childrenFx = this.childrenToFxNodes()[0] ?? fx.none();
    return fx.dispatch(name, settings, childrenFx);
  }
}

class FxDrip extends EffectElement {
  toFxNode(): FxNode {
    const streamKey = this.getAttribute("stream-key");
    if (!streamKey) return fx.none();

    const valueKey = this.getAttribute("value");
    if(valueKey) return fx.drip(ref<any>(valueKey), ref<DripperStream<any>>(streamKey));

    let data: any;
    const raw = this.textContent.trim();
    try {
      data = JSON.parse(raw);
    } catch(err) {
      data = raw;
    }
    return fx.drip(data, ref<DripperStream<any>>(streamKey));
  }
}

class FxTake extends EffectElement {
  toFxNode(): FxNode {
    const streamKey = this.getAttribute("stream-key");
    return streamKey
      ? fx.take(ref<Stream<any>>(streamKey), this.id)
      : fx.none();
  }
}

class FxYield extends EffectElement {
  toFxNode(): FxNode {
    const id = this.id;
    // idは対話に必須なため、なければエラーを出す
    if (!id) {
      console.error("<fx-yield> requires an 'id' attribute.");
      return fx.none();
    }
    const valueAttr = this.getAttribute("value");
    // value属性をrefとしてfx.yieldファクトリに渡す
    // valueが指定されていなければ、nullをyieldする
    return fx.yield(valueAttr ? ref(valueAttr) : null, id);
  }
}

class FxContext extends EffectElement {

  static noneResult = Symbol("none")

  protected context: Record<string, any>;

  constructor(context?: Record<string, any>) {
    super();
    this.context = context || {};
  }

  parentContext() : FxContext | null {
    return this.parentElement ? this.parentElement.closest("fx-context,fx-effect") : null;
  }

  toFxNode(): FxNode {
    const nodes = this.childrenToFxNodes();
    return !nodes.length
      ? fx.none() 
      : nodes.length === 1
      ? nodes[0]
      : fx.sequence(nodes);
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

class FxEffect extends FxContext {
  protected _execContext?: Partial<ExecContext>
  protected _preparedFx?: PreparedFx
  protected _handle?: ExecutionHandle
  
  connectedCallback() {
    // 1. prepare: 接続時に一度だけフローを準備（コンパイル）する
    const flow = this.toFxNode();
    this._preparedFx = prepare(flow, this.context, this._execContext);
    // 2. execute: 準備したフローを実行
    this._handle = execute(this._preparedFx);
  }

  disconnectedCallback() {
    this._handle?.cancel();
  }

}

// ... (EffectElementTagNameMapとfxdomの定義は変更なし) ...

const fxdom = {

  defineEffectElements: (tagNameMap: Record<string,typeof EffectElement> = EffectElementTagNameMap) => {
    // 引数でEffectElementに縛るため、defineはasで通す
    Object.entries(tagNameMap).forEach(([tag,cls])=>customElements.define(tag,cls as unknown as CustomElementConstructor));
  }

}

const EffectElementTagNameMap = {
  "fx-sequence": FxSequence,
  "fx-parallel": FxParallel,
  "fx-race":  FxRace,
  "fx-wait":  FxWait,
  "fx-call":  FxCall,
  "fx-include":  FxInclude,
  "fx-if":  FxIf,
  "fx-switch":  FxSwitch,
  "fx-loop":  FxLoop,
  "fx-dispatch":  FxDispatch,
  "fx-drip":  FxDrip,
  "fx-take":  FxTake,
  "fx-yield": FxYield,
  "fx-context":  FxContext,
  "fx-effect":  FxEffect,
}

export {FxCall,FxWait,FxEffect,FxDispatch,FxDrip,FxIf,FxInclude,FxParallel,FxRace,FxLoop,FxSequence,FxSwitch,FxTake,FxContext,fxdom,EffectElementTagNameMap};
