// blooky-fxdom.ts

import { isDripperStream, isStream, type Prop, type Stream } from "./blooky";
import { jshtml } from "./blooky-dom";
import { createCancelToken, execute, fx, FxMiddleware, run, type FxDispatchOptions, type FxNode, type IEffectContext } from "./blooky-effect"; // assume effect-core exists

type FxResolvable = Prop<any> | Stream<any> | Function | any;

// ---- Abstract Base ----

export abstract class EffectElement extends HTMLElement {
  abstract toFxNode(): FxNode;

  protected childrenToFxNodes(): FxNode[] {
    return Array.from(this.children)
      .filter((n): n is EffectElement => n instanceof EffectElement)
      .map((n) => n.toFxNode());
  }

  protected resolveContextValue(key : string, requiredUseAttr = false) : unknown {
    const provider = this.closest<FxContext>("fx-context,fx-effect");
    return provider?.getContextValue(key, requiredUseAttr) ?? undefined;
  }
  
}

// ---- Core Elements ----


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

class FxWait extends EffectElement {
  toFxNode(): FxNode {
    return fx.wait(Number(this.getAttribute("ms") || "0"));
  }
}

class FxCall extends EffectElement {
  toFxNode(): FxNode {
    try {
      const fnName = this.getAttribute("fn");
      if (!fnName) {
        throw new Error("<fx-call> requires a 'fn' attribute.");
      }

      const funcFromContext = this.resolveContextValue(fnName, true) as Function;
      const args = Array.from(this.querySelectorAll("arg"))
        .map(arg => {
          const raw = arg.getAttribute("value") ?? arg.textContent ?? "null";
          try {
            return JSON.parse(raw);
          } catch {
            throw new Error(`Invalid arg value: ${raw}`);
          }
        });
      
      const catcherKey = this.getAttribute("catcher");
      const catchFunc = catcherKey ? this.resolveContextValue(catcherKey, true) as (v:Error)=>void : undefined;
      if (typeof funcFromContext === "function") {
        return fx.call(() => funcFromContext(...args), typeof catchFunc === "function" ? catchFunc : undefined);
      }

      // どちらにも見つからない場合
      throw new Error(`Function '${fnName}' not found in context, and no 'src' was provided.`);
      
    } catch(err) {
      console.error("[fx-call] error occured:" + (err as Error).message);
      return fx.none();
    }
  }
}


/**
 * 読み込んだフローのDOMテンプレートをキャッシュするためのMap
 * string: JSONファイルのsrc
 * HTMLTemplateElement: パース済みのDOMフラグメントを保持するtemplate要素
 */
const flowTemplateCache = new Map<string, HTMLTemplateElement>();


// blooky-fxdom.ts

class FxInclude extends EffectElement { // FxFlowからFxIncludeにリネーム

  // 'src'属性の変更を監視対象に含める
  static get observedAttributes() {
    return ['src'];
  }

  // toFxNodeは変更なし
  toFxNode(): FxNode {
    return fx.sequence(this.childrenToFxNodes());
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
    const whenKey = this.getAttribute("when");
    const notKey = this.getAttribute("not");

    if (!whenKey && !notKey) return fx.none();

    let whenProp: Prop<boolean> = () => true;
    let notProp: Prop<boolean> = () => true;

    if (whenKey) {
      const resolved = this.resolveContextValue(whenKey);
      if (typeof resolved === "function") {
        whenProp = resolved as Prop<boolean>;
      } else {
        console.warn(`[fx-if] Prop "${whenKey}" not found or not a function.`);
      }
    }

    if (notKey) {
      const resolved = this.resolveContextValue(notKey);
      if (typeof resolved === "function") {
        const p = resolved as Prop<boolean>;
        notProp = () => !p();
      } else {
        console.warn(`[fx-if] Prop "${notKey}" not found or not a function.`);
      }
    }

    const condProp = () => whenProp() && notProp();

    const thenNode = this.querySelector('[slot="then"]') as EffectElement | null;
    if (!thenNode) {
      const childrenFx = this.childrenToFxNodes();
      return fx.condition(condProp, childrenFx.length ? fx.sequence(childrenFx) : fx.none());
    }

    const elseNode = this.querySelector('[slot="else"]') as EffectElement | null;
    return fx.condition(condProp, thenNode.toFxNode(), elseNode?.toFxNode());
  }
}


// blooky-fxdom.ts

class FxSwitch extends EffectElement {
  toFxNode(): FxNode {
    const by = this.getAttribute("by");
    if (!by) return fx.none();

    const condProp = this.resolveContextValue(by) as Prop<string>;
    if (!condProp || typeof condProp !== "function") {
      console.warn(`Prop "${by}" not found in context.`);
      return fx.none();
    }
    
    // 子要素を<slot名, FxNode>のMapに変換
    const cases = new Map(
      Array.from(this.children)
        .filter((e): e is EffectElement => e instanceof EffectElement && e.hasAttribute("slot"))
        .map(e => [
          e.getAttribute("slot")!,
          e.toFxNode() // 分岐先のFxNodeをここで事前に生成しておく
        ])
    );
    if(!cases.size) return fx.none();

    // defaultケースをMapから取り出して別途渡す
    const defaultNode = cases.get("default");
    cases.delete("default");

    // 新しいfx.switchファクトリを呼ぶだけ
    return fx.switch(condProp, cases, defaultNode);
  }
}


class FxLoop extends EffectElement {
  toFxNode(): FxNode {
    const whileKey = this.getAttribute("while");
    // while属性がある場合
    if (whileKey) {
      const condProp = this.resolveContextValue(whileKey) as Prop<boolean>;
      if (!condProp) {
        console.warn(`Prop "${whileKey}" not found for fx-repeat.`);
        return fx.none();
      }
      const bodyNode = fx.sequence(this.childrenToFxNodes());
      return fx.loop(() => condProp(), bodyNode);
    }
    const count = Number(this.getAttribute("count") || "0");
    // count属性がある場合（従来の処理）
    if (count > 0) {
      const each = fx.sequence(this.childrenToFxNodes());
      return fx.sequence(Array.from({ length: count }, () => each));
    }
    
    return fx.none();
  }
}
class FxDispatch extends EffectElement {
  toFxNode(): FxNode {
    const name = this.getAttribute("name");
    if (!name) return fx.none();

    let detail : any = {};
    if(this.hasAttribute("detail")) {
      const detailAttr = this.getAttribute("detail")!;
      const p = this.resolveContextValue(detailAttr) as Prop<any>;
      detail = p ? p() : {};
    }

    const target_attr = this.getAttribute("target") || "_self";
    const target = target_attr === "_self" ? this : target_attr;

    const options: FxDispatchOptions = {
      name,
      detail,
      target,
      bubbles: this.getAttribute("bubbles") !== "none",
      composed: this.getAttribute("composed") !== "none",
      cancelable: this.hasAttribute("cancelable")
    };

    const childrenFx = this.childrenToFxNodes()[0] ?? fx.none();

    return fx.dispatch(options, childrenFx);
  }
}


class FxDrip extends EffectElement {

  toFxNode(): FxNode {
    // 1. どのStreamにdripするかを属性で指定できるようにする
    const streamKey = this.getAttribute("stream-key");
    if (!streamKey) {
      console.error("<fx-drip> requires a 'stream-key' attribute.");
      return fx.none();
    }

    // 2. コンテキストから指定されたStreamを探す
    const stream = this.resolveContextValue(streamKey);
    if (!isDripperStream(stream)) {
        console.warn(`Stream with key "${streamKey}" not found in context.`);
        return fx.none();
    }

    // 3. 値を属性から取得する
    let value: any;
    const valueAttr = this.getAttribute("value");
    if (valueAttr !== null) {
      const ctxValue = this.resolveContextValue(valueAttr);
      if(typeof ctxValue === "function") {
        value = ctxValue();
      } else {
        try {
          value = JSON.parse(valueAttr);
        } catch (e) {
          console.warn("[fx-drip] Invalid JSON in value attribute.", valueAttr, e);
          value = valueAttr; // パース失敗時は文字列として扱う
        }
      }
    }
    // 4. fx.effectノードを返す
    return fx.drip(value, stream);
  }

}


class FxTake extends EffectElement {

  toFxNode(): FxNode {
    // 1. どのStreamにdripするかを属性で指定できるようにする
    const streamKey = this.getAttribute("stream-key");
    if (!streamKey) {
      console.error("<fx-take> requires a 'stream-key' attribute.");
      return fx.none();
    }
    // 2. コンテキストから指定されたStreamを探す
    const stream = this.resolveContextValue(streamKey);
    if (!isStream(stream)) {
        console.warn(`Stream with key "${streamKey}" not found in context.`);
        return fx.none();
    }

    // 3. fx.takeノードを返す
    return fx.take(stream);
  }

}

class FxContext extends EffectElement implements IEffectContext {

  static noneResult = Symbol("none")

  protected lastResult = FxContext.noneResult
  protected context: Map<string, FxResolvable>

  constructor(context?: Map<string, FxResolvable>) {
    super();
    this.context = context || new Map();
    this.context.set("lastResult", () => {
      let ctx : FxContext | null = this;
      while(ctx) {
        if(ctx.lastResult !== FxContext.noneResult) return ctx.lastResult;
        ctx = ctx.parentContext();
      }
      return null;
    });
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

  setContext(ctx: Record<string, FxResolvable>) {
    Object.entries(ctx).forEach(([k, v]) => this.context.set(k, v));
  }

  setRuntimeState({lastResult}: { lastResult: any }): void {
    this.lastResult = lastResult;
  }

  // use属性値をホワイトリストとして利用
  containedUseAttr(key: string) {
    const useList = this.getAttribute("use")?.replace(/\s+/g,"").split(",");
    return useList && useList.includes(key);
  }

    // 自分からルートまで値を検索する
  getContextValue(key: string, requiredUseAttr = false) : unknown {
    // 1. まず自分のコンテキストを確認
    if (this.context.has(key)) {
      if(requiredUseAttr === true && !this.containedUseAttr(key)) {
        throw new Error(`[fx-context] Invalid context key: "${key}" is not contained "use" attribute.`);
      }
      return this.context.get(key);
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


// ---- FxEffect Root Element ----

class FxEffect extends FxContext {

  private _cancel?: () => void;
  private _hasRun = false; // 再実行制御用フラグ

  // デバッガークラスで差し替えできるようにする
  protected executer: typeof execute = execute;
  protected runner: typeof run = run;
  protected middleWares: FxMiddleware[];

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot!.replaceChildren(jshtml([
        { style: ':host { display: none; }' },
        { slot: null }
      ]));
    }

    if (!this._hasRun) {
      this.run();
    }
  }

  disconnectedCallback() {
    this._cancel?.();
    this._hasRun = false; // 再実行を許可するためにfalseに戻す
  }

// blooky-fxdom-debugger.ts 内のデバッグ用 FxEffect クラス

  async run() {
    // すでに走っていたらキャンセル
    this._cancel?.();
    // デバッグ用Middlewareを注入してexecuterを呼び出す
    const { cancel } = await this.executer(
      this.runner(this.toFxNode()),
      this,
      createCancelToken(), // 新しいtokenを生成
      this.middleWares
    );
    this._cancel = cancel;
    this._hasRun = true;
  }

  /*
  async run() {
    // すでに走っていたらキャンセル
    this._cancel?.();
    const { cancel } = await this.executer(this.runner(this.toFxNode()),this);
    this._cancel = cancel;
    this._hasRun = true;
  }
    */

  runWith(other: Map<string, FxResolvable>) {
    const temp = this.context;
    this.context = new Map([...temp,...other]);
    this.run();
    this.context = temp;
  }

  /** 明示的にキャンセルするAPIも公開する（任意） */
  public cancel() {
    this._cancel?.();
    this._hasRun = false;
  }
}


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
  "fx-context":  FxContext,
  "fx-effect":  FxEffect,
}

export {FxCall,FxWait,FxEffect,FxDispatch,FxDrip,FxIf,FxInclude,FxParallel,FxRace,FxLoop,FxSequence,FxSwitch,FxTake,FxContext,fxdom,EffectElementTagNameMap};
