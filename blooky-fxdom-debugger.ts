// blooky-fxdom-debbuger.ts
import { createCancelToken, fxHandlers as defaultFxHandlers, run, yieldToMainThread, type CancelToken, type FxNode, type FxHandlerArg, type FxHandlerMap, type IEffectContext } from "./blooky-effect";
import { EffectElementTagNameMap as DefaultEffectElementTagNameMap, EffectElement, FxEffect as ConcreteEffectElementConstructor, fxdom } from "./blooky-fxdom";

const FxNodeMap = new WeakMap<FxNode, EffectElement>();

const DebEffectElementStyleSheet = new CSSStyleSheet();
DebEffectElementStyleSheet.replaceSync(`
/* EffectElementのShadow DOM内 */
:host {
  display: block;
  margin: 0.75em 0 0.75em 16px; /* ネストを表現 */
  padding: 1em;
  border: 1px solid var(--fx-border-color, #ccc);
  border-radius: var(--fx-border-radius, 4px);;
  position: relative;
  transition: all 0.3s ease;
}
/* 要素の種類をラベルとして表示 */
:host::before {
  content: attr(data-fx-type); /* タグ名などを表示 */
  position: absolute;
  top: -0.7em;
  left: 8px;
  padding: 0 4px;
  background: white;
  color: var(--fx-label-color, #666);
  font-size: 0.8em;
  font-family: monospace;
}
/* 実行状態のスタイル */
:host(.is-running) {
  border-color: var(--fx-running-border-color, #007bff);
  box-shadow: 0 0 5px var(--fx-running-shadow-color, rgba(0, 123, 255, 0.5));
}

:host(.is-paused) {
  border-style: dashed;
  border-color: var(--fx-paused-border-color, #ffc107);
}
:host(.is-paused)::before {
  content: attr(data-fx-type) "(paused)";
}
:host(.is-completed) {
  opacity: 0.6;
  border-left: 5px solid var(--fx-completed-border-color, #28a745);
}
/* is-completed と is-recovered が両方付いた場合のスタイル */
:host(.is-completed.is-recovered) {
  border-left-color: var(--fx-completed-border-color, #28a745);
  box-shadow: 0 0 5px var(--fx-paused-border-color, #ffc107);
}
:host(.is-completed.is-recovered)::before {
  content: attr(data-fx-type) " (recovered)";
}

:host([slot])::before {
  content: attr(data-fx-type) "(slot=[" attr(slot) "])";
}
`);


function createPropertyDescriptorForFxHandler(key: "wait"|"take"): PropertyDescriptor {
  const method = defaultFxHandlers[key];
  return {
    async value(this:FxHandlerMap,arg:any) {
      const element = FxNodeMap.get(arg.node);
      element?.classList.add('is-paused');
      const result = await method(arg);
      element?.classList.remove('is-paused');
      return result;
    }
  }
}

// fxNodeの処理時、参照を残したEffectElementに処理状況を示すclassを設定する
const fxHandlers:FxHandlerMap = Object.create(defaultFxHandlers, {
  wait: createPropertyDescriptorForFxHandler("wait"),
  take: createPropertyDescriptorForFxHandler("take")
});

async function execute(
  generator: Generator<FxNode, void, any>,
  context: IEffectContext = {
    getContextValue:(key:string)=>context.hasOwnProperty(key) ? (context as IEffectContext & { [key:string]: any })[key] : undefined,
    setRuntimeState:(state)=>Object.assign(context,state)
  } as IEffectContext & { [key:string]: any },
  token: CancelToken = createCancelToken()
) {
  let result = generator.next();
  while (!result.done) {
    const node = result.value;
    // --- 実行前のUI更新 ---
    const element = FxNodeMap.get(node);
    element?.classList.add('is-running');

    const handler = fxHandlers[node.type] as (o:FxHandlerArg<typeof node.type>)=>void;
    if (!handler) throw new Error(`Unhandled FxNode type: ${node.type}`);

    let nextValue: unknown;
    try {
      nextValue = await handler({ node, context, token, execute, run });
    } catch (err) {
      // ① 失敗した要素に、まず永続的な失敗クラスを付与
      element?.classList.add('is-failed');

      const catcher = (node as any).catcher;
      if (typeof catcher === 'function') {
        console.warn(`[fx-effect] Action failed, but was handled by context.`, catcher);
        nextValue = catcher(err); // ② 値が回復される
        // is-failedはこの後のis-completedで上書きされるので、ここでは消さない
      } else if (!element || element.dispatchEvent(new CustomEvent("throw", {
          cancelable: true,
          bubbles: true,
          composed: true,
          detail: {
            error: err,
            failedNode: node,
            context
          }
        }))) {
        console.error(`[fx-effect] Unhandled error: Catch handler not found in context.`);
        throw err; // ③ 回復不能なエラー。is-failedは残ったままフローが停止する
      }
      // 回復された場合は、catchブロックから抜けて正常系の処理に戻る
    }

    // --- 実行後のUI更新 ---
    if (element) {
      element.classList.remove('is-running');
      // 正常に完了、またはエラーから回復した場合
      if (!token.cancelled()) {
        if(element.classList.contains("is-failed")) {
          element.classList.remove('is-failed'); // 失敗していた場合は回復した印として消す
          element.classList.add('is-recovered');
        }
        element.classList.add('is-completed');
      }
    }

    context.setRuntimeState({ lastResult: nextValue });
    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  return { context, cancel: token.cancel };
}

// EffectElementを全て動的にデバッグ用途にextendsさせる
const EffectElementTagNameMap = Object.fromEntries(new Map(Object.entries(DefaultEffectElementTagNameMap)));
Object.entries(EffectElementTagNameMap).forEach(([tag,fxClass])=>{
  // fxClassはコンストラクタの共用型なので、`extends`句のエラーを回避するために
  // 具体的なクラス型にキャストする。これにより、super.toFxNode()の呼び出しが
  // 型安全に解決され、かつ基底クラスのabstract制約も維持される。    
  EffectElementTagNameMap[tag] = class extends (fxClass as typeof ConcreteEffectElementConstructor) {
    connectedCallback() {
      super.connectedCallback?.();
      // Shadow DOMがまだなければ、ここで生成する
      const shadow = this.shadowRoot || this.attachShadow({ mode: 'open' });
      shadow.adoptedStyleSheets.push(DebEffectElementStyleSheet);
      if(!shadow.querySelector("slot"))
        shadow.append(document.createElement("slot"));
      this.setAttribute("data-fx-type", this.tagName.toLowerCase());
    }
    toFxNode() : FxNode {
        const result = super.toFxNode() as FxNode;
        FxNodeMap.set(result, this);
        return result;
    }
  };
});

// switchは名前付きslotを全て書き出す
EffectElementTagNameMap["fx-switch"] = class extends (EffectElementTagNameMap["fx-switch"] as typeof ConcreteEffectElementConstructor) {
  connectedCallback(): void {
    super.connectedCallback();
    this.shadowRoot!.querySelector("slot")?.remove();
    this.shadowRoot!.append(...Array.from(this.querySelectorAll("*[slot]")).map((elm)=>{
      const slot = document.createElement("slot");  
      slot.name = elm.slot;
      return slot;
    }));
  }
}
// effectはルートでテーマ変数をstyleに追加
EffectElementTagNameMap["fx-effect"] = class extends (EffectElementTagNameMap["fx-effect"] as typeof ConcreteEffectElementConstructor) {
  protected executer = execute as any
  connectedCallback(): void {
    super.connectedCallback();
    this.shadowRoot!.querySelector("style")!.textContent += `
:host {
  /* デバッグUIのテーマ変数をここで一元管理 */
  --fx-border-color: #ccc;
  --fx-border-radius: 4px;
  --fx-label-color: #666;
  --fx-running-border-color: #007bff;
  --fx-running-shadow-color: rgba(0, 123, 255, 0.5);
  --fx-completed-border-color: #28a745;
  --fx-paused-border-color: #9a760bff;
}`;
  }
}

// 呼び出し元で fxdom.defineEffectElements(EffectElmentTagNameMap) すること。

export {fxdom,EffectElementTagNameMap,execute,fxHandlers};
