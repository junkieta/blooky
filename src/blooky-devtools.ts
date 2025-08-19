<<<<<<< HEAD
import { isChainedProp, isDripperStream, isStream, Prop, Stream } from "./blooky-fp";
=======
import { isChainedProp, isDripperStream, isStream, Prop, Stream } from "./blooky";
>>>>>>> ba206c321d00efab36d43ac58fe3135327181708
import { EffectElementTagNameMap as DefaultEffectElementTagNameMap, EffectElement, FxEffect as ConcreteEffectElementConstructor, fxdom } from "./blooky-fxdom";
import { FxNode, FxCompiledNode, FxMiddleware, ExecContext } from "./fx/types";

const FxNodeMap = new WeakMap<FxNode, EffectElement>();
const getElementByCompiledNode = (n: FxCompiledNode) : EffectElement | undefined => FxNodeMap.get(Object.getPrototypeOf(n)!);

const DebEffectElementStyleSheet = new CSSStyleSheet();
DebEffectElementStyleSheet.replaceSync(`
/* EffectElementのShadow DOM内 */
:host {
  display: block;
  margin: 0.75em 0 0.75em 16px; /* ネストを表現 */
  padding: 1em;
  border: 1px solid var(--fx-border-color, #ccc);
  border-radius: var(--fx-border-radius, 4px);
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

// svg用のスタイル
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
.is-emitting {
  transition: fill 0.1s;
  fill: red;
}
/* is-emittingクラスが付与されたらアニメーションを適用 */
.node.is-emitting {
  animation: pulse 0.5s ease-out;
}
@keyframes pulse {
  0% { stroke: #333; stroke-width: 1px; }
  50% { stroke: crimson; stroke-width: 3px; }
  100% { stroke: #333; stroke-width: 1px; }
}
`);
document.adoptedStyleSheets.push(sheet);

const debugMiddleware: FxMiddleware = async (ctx, next) => {
  const { node } = ctx;
  const element = getElementByCompiledNode(node);
  if(!element) return await next();

  let result: any = null;
  try {
    // --- 内側の処理（次のMiddlewareまたはコア）を呼び出す ---
    if(node.type === "wait" || node.type === "take" || node.type === "yield") {
      element?.classList.add("is-paused");
      result = await next();
      element?.classList.remove("is-paused");
    } else {
      result = await next();
    }
  } catch (err) {
    // --- 後処理（エラー時） ---
    if(!element || element.dispatchEvent(new CustomEvent("throw", {
        cancelable: true,
        bubbles: true,
        composed: true,
        detail: {
          error: err,
          failedNode: node,
          ctx
        }
      }))) {
        // ... dispatchEventによるエラー通知がキャンセルされなければ、停止 ...
        console.error(`[fx-effect] Unhandled error: Catch handler not found in context.`, err);
        throw err; // 回復不能なエラー。is-failedは残ったままフローが停止する
    }
    // 回復された場合は、catchブロックから抜けて正常系の処理に戻る
    element?.classList.add("is-recovered");
  }
  return result;
};


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
    this.shadowRoot!.append(
      new Text("by=["+this.getAttribute("by")!+"]"),
      ...Array.from(this.querySelectorAll("*[slot]")).map((elm)=>{
        const slot = document.createElement("slot");  
        slot.name = elm.slot;
        return slot;
      })
    );
  }
}

EffectElementTagNameMap["fx-take"] = class extends (EffectElementTagNameMap["fx-take"] as typeof ConcreteEffectElementConstructor) {
  connectedCallback(): void {
    super.connectedCallback();
    this.append(new Text(`stream-key=["${this.getAttribute("stream-key")}"]`));
  }
}


// dripはターゲットのStreamのグラフと紐づける
EffectElementTagNameMap["fx-drip"] = class extends (EffectElementTagNameMap["fx-drip"] as typeof ConcreteEffectElementConstructor) {
  static observedAttributes = ["class"];
  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if(name !== "class" || newValue !== "is-running") return;
    const streamKey = this.getAttribute("stream-key")!; if(!streamKey) return;
    const nodeElement = document.getElementById(`node-${streamKey}`); if(!nodeElement) return;
    nodeElement.classList.add('is-emitting');
    // アニメーションが終わったらclassを削除
    setTimeout(() => nodeElement.classList.remove('is-emitting'), 1500);
  }
}


const ExecContextForDebug : Partial<ExecContext> = {
  middlewares: [debugMiddleware],
  onNodeEnter(node: FxCompiledNode): void {
    const element = getElementByCompiledNode(node);
    element?.classList.add('is-running');
  },
  onNodeExit(node: FxCompiledNode, error?: any): void {
    const element = getElementByCompiledNode(node);
    if(!element) return;
    element.classList.remove('is-running');
    if (error) {
      element.classList.add('is-failed');
    } else {
      element.classList.add("is-completed");
    }
  }
}

// effectはルートでテーマ変数をstyleに追加
EffectElementTagNameMap["fx-effect"] = class extends (EffectElementTagNameMap["fx-effect"] as typeof ConcreteEffectElementConstructor) {
  
  static observedAttributes = ["theme"];

  private themeCSS? : CSSStyleSheet;
  protected _execContext?: Partial<ExecContext> | undefined = ExecContextForDebug

  loadTheme(src: string) {
    if(!src || !this.shadowRoot) return;
    if(!this.themeCSS) {
      this.themeCSS = new CSSStyleSheet();
      this.shadowRoot!.adoptedStyleSheets.push(this.themeCSS);
    }
    fetch(src).then((res)=>res.text()).then((text)=>this.themeCSS!.replace(text));
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if(name === "theme" && oldValue !== newValue)
      this.loadTheme(newValue);
  }

  connectedCallback(): void {
    super.connectedCallback();
    if(this.hasAttribute("theme")) this.loadTheme(this.getAttribute("theme")!);
  }  

}

// 呼び出し元で fxdom.defineEffectElements(EffectElmentTagNameMap) すること。
export {fxdom,EffectElementTagNameMap,debugMiddleware};

// グラフ描画
function dumpGraphDOT(entries: Record<string, Stream<any> | Prop<any>>): string {
  const names = new WeakMap(Object.entries(entries).map(([k,v])=>[v,k]));
  const visited = new WeakMap<any, string>(); // obj → nodeId
  const edges: string[] = [];
  const nodes: string[] = [];
  let counter = 0;

  function addNode(label: string, shape = "ellipse") {
    const id = `n${counter++}`;
    nodes.push(`${id} [label="${label}", shape=${shape}, id="node-${label}"]`);
    return id;
  }

  function getShape(node: Stream<any>|Prop<any>) {
    if(isChainedProp(node))
        return "box";
    if(isDripperStream(node))
        return "ellipse";
    if("mapFn" in node)
        return "diamond";
    if("filterFn" in node)
        return "triangle";
    if("reduceFn" in node)
        return "hexagon";
    return "plain";
  }

  function visit(obj: any, label: string) {
    if (visited.has(obj)) return visited.get(obj)!;

    const shape = getShape(obj);
    let id: string;
    if (isStream(obj)) {
      id = addNode(label, shape);
      visited.set(obj, id);

      for (const relType of ["next", "lazyNext"]) {
        const set = obj[relType] as Set<any>;
        if (!set) continue;
        for (const target of set) {
          const targetLabel = names.get(target) || (isChainedProp(target) ? "Prop" : "Stream");
          const targetId = visit(target, targetLabel);
          edges.push(`${id} -> ${targetId}`);
        }
      }
    } else {
      id = addNode(label, shape);
      visited.set(obj, id);
    }

    return id;
  }

  Object.entries(entries).forEach(([name,streamOrProp]) => {
    visit(streamOrProp, name);
  })

  return `digraph BlookyGraph {\nrankdir=LR;\n${nodes.join("\n")}\n${edges.join("\n")}\n}`;
}


export {dumpGraphDOT};