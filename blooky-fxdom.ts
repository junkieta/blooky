// blooky-fxdom.ts

import { isStream, Prop, Stream } from "./blooky";
import { fx, FxDispatchOptions, FxNode, IEffectContext, runCancelable } from "./blooky-effect"; // assume effect-core exists

type FxResolvable = Prop<any> | Stream<any> | Function;

// ---- Abstract Base ----

export abstract class EffectElement extends HTMLElement {
  abstract toFxNode(): FxNode;

  protected childrenToFxNodes(): FxNode[] {
    return Array.from(this.children)
      .filter((n): n is EffectElement => n instanceof EffectElement)
      .map((n) => n.toFxNode());
  }
}

// ---- Core Elements ----

class FxSequence extends EffectElement {
  toFxNode(): FxNode {
    return fx.sequence(this.childrenToFxNodes());
  }
}
customElements.define("fx-sequence", FxSequence);

class FxParallel extends EffectElement {
  toFxNode(): FxNode {
    return fx.parallel(this.childrenToFxNodes());
  }
}
customElements.define("fx-parallel", FxParallel);

class FxRace extends EffectElement {
  toFxNode(): FxNode {
    return fx.race(this.childrenToFxNodes());
  }
}
customElements.define("fx-race", FxRace);

class FxDelay extends EffectElement {
  toFxNode(): FxNode {
    return fx.delay(Number(this.getAttribute("ms") || "0"));
  }
}
customElements.define("fx-delay", FxDelay);

class FxCall extends EffectElement {
  toFxNode(): FxNode {
    const src = this.getAttribute("src");
    const fnName = this.getAttribute("fn");
    if (!fnName) {
      throw new Error("<fx-call> requires a 'fn' attribute.");
    }

    const args = Array.from(this.querySelectorAll("arg"))
      .map(arg => {
        const raw = arg.getAttribute("value") ?? arg.textContent ?? "null";
        try {
          return JSON.parse(raw);
        } catch {
          throw new Error(`Invalid arg value: ${raw}`);
        }
      });

    // Case 1: src属性がある場合 → 動的import
    if (src) {
      return fx.call(async () => {
        const mod = await import(src);
        const func = mod[fnName];
        if (typeof func !== "function") throw new Error(`Function '${fnName}' not found in module '${src}'`);
        return func(...args);
      });
    }

    // Case 2: src属性がない場合 → コンテキストから関数を取得
    const provider = this.closest<FxContext>("fx-context,fx-effect");
    const funcFromContext = provider?.getContextValue(fnName) as Function;

    if (typeof funcFromContext === "function") {
      return fx.call(() => funcFromContext(...args));
    }

    // どちらにも見つからない場合
    throw new Error(`Function '${fnName}' not found in context, and no 'src' was provided.`);
  }
}
customElements.define("fx-call", FxCall);


// FxIf 要素の実装イメージ
class FxIf extends EffectElement {
  toFxNode(): FxNode {
    const key = this.getAttribute("when");
    if (!key) return fx.none();

    // 自分から一番近いプロバイダを探す
    const provider = this.closest<FxContext>("fx-context,fx-effect");
    const condProp = provider?.getContextValue(key) as Prop<boolean>;

    if (!condProp) {
        console.warn(`Prop "${key}" not found in context.`);
        return fx.none();
    }
    
    const thenNode = this.querySelector('[slot="then"]') as EffectElement | null;
    const elseNode = this.querySelector('[slot="else"]') as EffectElement | null;

    return fx.condition(() => condProp(), thenNode?.toFxNode() ?? fx.none(), elseNode?.toFxNode());
  }
}

customElements.define("fx-if", FxIf);

class FxSwitch extends EffectElement {
  toFxNode(): FxNode {
    const by = this.getAttribute("by");
    if (!by) return fx.none();

    // 自分から一番近いプロバイダを探す
    const provider = this.closest<FxContext>("fx-context,fx-effect");
    const condProp = provider?.getContextValue(by) as Prop<string>;

    if (!condProp) {
        console.warn(`Prop "${by}" not found in context.`);
        return fx.none();
    }

    const map = new Map(Array.from(this.children)
      .filter((e)=>e instanceof EffectElement && e.hasAttribute("slot"))
      .map((e)=>[e.getAttribute("slot"), e] as [string, EffectElement]));

    return fx.condition(() => map.has(condProp()),
      map.get(condProp())?.toFxNode() ?? fx.none(),
      map.get("default")?.toFxNode() ?? fx.none()
    );
  }
}

customElements.define("fx-switch", FxSwitch);


class FxContext extends EffectElement implements IEffectContext {

  private context: Map<string, FxResolvable> = new Map();
  private state: { previousNode: FxNode, result: any };

  parentContext() : FxContext | null {
    return this.parentElement ? this.parentElement.closest("fx-context,fx-effect") : null;
  }

  toFxNode(): FxNode {
    return this.childrenToFxNodes()[0] ?? fx.none();
  }

  // プロパティ経由でコンテキストを設定する
  setContext(ctx: Record<string, FxResolvable>) {
    this.context = new Map(Object.entries(ctx));
  }

  setRuntimeState(state: { previousNode: FxNode; result: any; }): void {
    this.state = state;
  }

  // 自分からルートまで値を検索する
  getContextValue(key: string): FxResolvable | { previousNode: FxNode, result: any } | undefined {
    if(key === "state") return this.state;
    // use属性値をホワイトリストとして利用
    const useList = this.getAttribute("use")?.replace(/\s+/g,"").split(",");
    if(useList && !useList.includes(key)) {
      console.warn(`[fx-context] Invalid context key: "${key}" is not contained "use" attribute.`);
    }
    
    // 1. まず自分のコンテキストを確認
    if (this.context.has(key)) {
      return this.context.get(key);
    }
    // 2. なければ、親コンテキストに問い合わせる
    const parent = this.parentContext();
    if (parent) {
      return parent.getContextValue(key); // 親に対して同じ関数を再帰的に呼び出す
    }
    // 3. 親がいなければ（ルートまで到達）、undefinedを返す
    return undefined;
  }

}
customElements.define("fx-context", FxContext);


class FxRepeat extends EffectElement {
  toFxNode(): FxNode {
    const count = Number(this.getAttribute("count") || "0");
    const each = this.childrenToFxNodes()[0] ?? fx.none();
    return fx.sequence(Array.from({ length: count }, () => each));
  }
}
customElements.define("fx-repeat", FxRepeat);

class FxDispatch extends EffectElement {
  toFxNode(): FxNode {
    const name = this.getAttribute("name");
    if (!name) return fx.none();

    let detail: any = {};
    try {
      detail = JSON.parse(this.getAttribute("detail") || "{}");
    } catch (e) {
      console.warn("[fx-dispatch] Invalid JSON in detail");
    }

    const target_attr = this.getAttribute("target") || "_self";
    const target = target_attr === "_self" ? this : target_attr;

    const options: FxDispatchOptions = {
      name,
      detail,
      target,
      bubbles: this.hasAttribute("bubbles"),
      composed: this.hasAttribute("composed"),
      cancelable: this.hasAttribute("cancelable")
    };

    const childrenFx = this.childrenToFxNodes()[0] ?? fx.none();

    return fx.dispatch(options, childrenFx);
  }
}
customElements.define("fx-dispatch", FxDispatch);


class FxDrip extends EffectElement {

  toFxNode(): FxNode {
    // 1. どのStreamにdripするかを属性で指定できるようにする
    const streamKey = this.getAttribute("stream-key");
    if (!streamKey) {
      console.error("<fx-drip> requires a 'stream-key' attribute.");
      return fx.none();
    }

    // 2. コンテキストから指定されたStreamを探す
    const provider = this.closest<FxContext>("fx-context, fx-effect");
    const stream = provider?.getContextValue(streamKey);
    if (!isStream(stream)) {
        console.warn(`Stream with key "${streamKey}" not found in context.`);
        return fx.none();
    }

    // 3. 値を属性から取得する（既存のロジックと同じ）
    let value: any;
    const valueAttr = this.getAttribute("value");
    if (valueAttr !== null) {
      try {
        value = JSON.parse(valueAttr);
      } catch (e) {
        console.warn("[fx-drip] Invalid JSON in value attribute.", e);
        value = valueAttr; // パース失敗時は文字列として扱う
      }
    }
    // 4. fx.effectノードを返す
    return fx.drip(stream, value);
  }

}

customElements.define("fx-drip", FxDrip);

// ---- FxEffect Root Element ----

class FxEffect extends FxContext {

  private _cancel?: () => void;

  connectedCallback() {
    this.attachShadow({ mode: 'open' }); // 'closed'ではなく'open'
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: none; /* デフォルトでは非表示 */
        }
        :host([debug-mode]) {
          display: block; /* デバッグモードの時だけ表示 */
          border: 1px dashed gray;
          padding: 8px;
          margin: 4px;
        }
      </style>
      <slot></slot>
    `;
    if(this.hasAttribute("autostart"))
      this.run();
  }

  run() {
    const fxNode = this.childrenToFxNodes()[0] ?? fx.none();
    const { cancel } = runCancelable(fxNode, this);
    this._cancel = cancel;
  }

  disconnectedCallback() {
    this._cancel?.();
  }

}

customElements.define("fx-effect", FxEffect);