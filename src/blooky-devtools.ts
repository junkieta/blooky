import { jshtml } from "./blooky-dom";
import { isChainedProp, isDripperStream, isStream, isVertex, Prop, Stream, Vertex, vertex } from "./blooky-fp";
import { EffectElementTagNameMap as DefaultEffectElementTagNameMap, EffectElement, FxEffect as ConcreteEffectElementConstructor, fxdom } from "./blooky-fxdom";
import { FxNode, FxMiddleware, ExecContext } from "./fx/types";

const FxNodeMap = new WeakMap<FxNode, EffectElement>();
const FxElementStates = new WeakMap<EffectElement, CustomStateSet>();
const getFxElement = (n: FxNode) : EffectElement | undefined => FxNodeMap.get(n);

// fx要素の可視化用スタイルシート
const DebEffectElementStyleSheet = new CSSStyleSheet();
const devtoolsCSSPath = "./blooky-devtools-nested.css";
fetch(devtoolsCSSPath).then((res)=>res.text()).then((text)=>DebEffectElementStyleSheet.replace(text));

const debugMiddleware: FxMiddleware = async (ctx, next) => {
  const { node } = ctx;
  const element = getFxElement(node);
  if(!element) return await next();
  const states = FxElementStates.get(element)!;

  let result: any = null;
  try {
    // --- 内側の処理（次のMiddlewareまたはコア）を呼び出す ---
    if(node.type === "wait" || node.type === "yield") {
      states.add("paused");
      result = await next();
      states.delete("paused");
    } else {
      result = await next();
    }
  } catch (err) {
    // --- 後処理（エラー時） ---
    states.add("failed");
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
    states.delete("failed");
    states.add("recovered");
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

    // CustomStateSetを利用する
    constructor() {
      super();
      FxElementStates.set(this, this.attachInternals().states);
    }

    connectedCallback() {
      super.connectedCallback?.();
      // Shadow DOMがまだなければ、ここで生成する
      const shadow = this.shadowRoot || this.attachShadow({ mode: 'open' });
      shadow.adoptedStyleSheets.push(DebEffectElementStyleSheet);
      const tag = { var: this.tagName.toLowerCase(), $: { class: "tag" } };
      shadow.insertBefore(
        jshtml({
          code: this.hasAttributes()
            ? [
              tag,
              Array.from(this.attributes).map(({name,value})=>[
                { code: "[" },
                { var: name, $: { class: "name" } },
                { code: '="' },
                { var: value, $: { class: "value" } },
                { code: '"]' }
              ]),
            ]
            : tag,
          $: { class: "selector" }
        }),
        shadow.firstChild
      );
      if(!shadow.querySelector("slot"))
        shadow.append(document.createElement("slot"));
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
    })
    );
  }
}

// collapseはターゲットのStreamのグラフと紐づける
EffectElementTagNameMap["fx-collapse"] = class extends (EffectElementTagNameMap["fx-collapse"] as typeof ConcreteEffectElementConstructor) {
  constructor() {
    super();
    this.addEventListener("changestate", (e) => {
      const state = (e as CustomEvent<string>).detail;
      if(state !== "running") return;
      const streamKey = (e.currentTarget as HTMLElement).getAttribute("dripper")!; if(!streamKey) return;
      const nodeElement = document.getElementById(`node-${streamKey}`); if(!nodeElement) return;
      nodeElement.classList.add('is-emitting');
      // アニメーションが終わったらclassを削除
      setTimeout(() => nodeElement.classList.remove('is-emitting'), 1500);
    });
  }
}


const ExecContextForDebug : Partial<ExecContext> = {
  middlewares: [debugMiddleware],
  onNodeEnter(node: FxNode): void {
    const element = getFxElement(node)!;
    if(FxElementStates.has(element))
      FxElementStates.get(element)!.add('running');
    element.dispatchEvent(new CustomEvent("changestate", {
      bubbles: true,
      detail: "running"
    }))
  },
  onNodeExit(node: FxNode, reason?: any, error?: any): void {
    const element = getFxElement(node);
    if(!element) return;
    const states = FxElementStates.get(element)!;
    states.delete('running');
    if (error) {
      states.add('failed');
    }
    else if(reason) {
      states.add(reason);
    }
    else {
      states.add("completed");
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

// グラフ描画
function dumpGraphDOT(entries: Record<string, Stream<any> | Prop<any> | unknown>): string {
  const vertex_map: [string, Vertex|Prop<any>|unknown][] = Object.entries(entries).map(([k,v])=> !isStream(v) ? [k,v] : [k,vertex(v)]);

  const names = new WeakMap(vertex_map.map(([k,v])=>[Object(v),k]));
  const visited = new WeakMap<any, string>(); // obj → nodeId
  const edges: string[] = [];
  const nodes: string[] = [];
  let counter = 0;

  function addNode(label: string, shape = "ellipse") {
    const id = `n${counter++}`;
    nodes.push(`${id} [label="${label}", shape=${shape}, id="node-${label}"]`);
    return id;
  }

  function getShape(node: Stream<any>) {
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

  function visit(obj: Vertex|Prop<any>, label: string) {
    if (visited.has(obj)) return visited.get(obj)!;

    if (isChainedProp<any>(obj)) {
      const id = addNode(label, "box");
      visited.set(obj, id);
      return id;
    }

    if(!isVertex(obj)) {
      const id = addNode(label, "circle");
      visited.set(obj, id);
      return id;
    }

    const id = addNode(label, names.has(obj) ? getShape(obj.source) : "point");
    visited.set(obj, id);

    for (const relType of ["next", "lazyNext"]) {
      const next = obj[relType] as Vertex[];
      if (next) edges.push(...next.map((target)=>{
        const targetLabel = names.get(target) || "Stream";
        const targetId = visit(target, targetLabel);
        return `${id} -> ${targetId}`;
      }));
    }
    const props = obj.props;
    if(props) edges.push(...props.map((p) => `${id} -> ${visit(p, names.get(p) || "none")}`));
    return id;
  }

  vertex_map.forEach(([name,streamOrProp]) => {
    visit(streamOrProp as Vertex|Prop<any>, name);
  })

  return `digraph BlookyGraph {\nrankdir=LR;\n${nodes.join("\n")}\n${edges.join("\n")}\n}`;
}


export {dumpGraphDOT};

