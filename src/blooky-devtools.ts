import { jshtml, mutations, prime } from "./blooky-fv";
import { filter, hold, isChainedProp, isDripperStream, isStream, isVertex, map, vertex } from "./blooky-fp";
import { EffectElementTagNameMap as DefaultEffectElementTagNameMap, EffectElement, FxEffectElement as ConcreteEffectElementConstructor, fxdom } from "./blooky-fxdom";
import { FxNode, FxMiddleware, ExecContext } from "./fx/types";
import DebugController from "./fx/debugger"; // 追加

// create a global debug controller
const debugCtrl = new DebugController();

const FxNodeMap = new WeakMap<FxNode, EffectElement>();
const FxElementStates = new WeakMap<EffectElement, CustomStateSet>();
const getFxElement = (n: FxNode) : EffectElement | undefined => FxNodeMap.get(n);

// fx要素の可視化用スタイルシート
const devtoolsCSSPath = ["./blooky-devtools-nested.css","./blooky-devtools-theme.css"];
const DevEffectElementStyleSheets = Promise.all(devtoolsCSSPath.map(async(path)=>{
  const res = await fetch(path);
  const text = await res.text();
  const sheet = new CSSStyleSheet();
  await sheet.replace(text);
  return sheet;
}));



// 🆕 Global DebugController
const globalDebugController = new DebugController();

// 🆕 debugMiddleware の更新（ExecutionStep ベース）
const debugMiddleware: FxMiddleware = async ({ step, node, executionId }, next) => {
  const element = getFxElement(node);
  
  if (element) {
    // DOM に状態を反映
    element.setAttribute('data-phase', step.phase);
    element.setAttribute('data-execution-id', executionId);
    
    if (step.visual?.label) {
      element.setAttribute('aria-label', step.visual.label);
    }
    
    // CustomStateSet に反映
    const states = FxElementStates.get(element);
    if (states) {
      states.add(step.phase);
      
      // 色の反映
      if (step.visual?.color) {
        element.style.setProperty('--phase-color', step.visual.color);
      }
    }
  }
  
  await next();
  
  // cleanup
  if (element) {
    const states = FxElementStates.get(element);
    if (states) {
      states.delete(step.phase);
    }
  }
};

// ExecContextForDebug の更新
const ExecContextForDebug: Partial<ExecContext> = {
  middlewares: [debugMiddleware],
  debugController: globalDebugController,
};

export { globalDebugController as DebugController };
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
      DevEffectElementStyleSheets.then((sheets)=>shadow.adoptedStyleSheets.push(...sheets));
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



// function to attach debugController to every fx-effect element in the page and expose controls
function attachDevtoolsToEffects() {

    const hasEffectClosest = (n: Node) => {
        if(n.nodeType !== 1) return n.parentElement ? hasEffectClosest(n.parentElement) : false;
        return (n as Element).closest("fx-effect") !== null || (n as Element).querySelector("fx-effect") !== null;
    };

    const effectMutations = filter((evt: BlookyMutationEvent)=>
        evt.detail.records.some((record)=> Array.from(record.addedNodes).some(hasEffectClosest) || Array.from(record.removedNodes).some(hasEffectClosest))
    )(mutations({ childList: true, subtree: true })(document.body));

    const $effectElements = hold([])(
        map((evt:BlookyMutationEvent)=>{
            const effects = (evt.currentTarget as HTMLElement).getElementsByTagName('fx-effect');
            return Array.from(effects).map((el, idx)=>{
                const fxEl = el as any;

                try {
                    const prepared = fxEl._preparedFx || fxEl.prepare();
                    const execId = prepared.execContext.executionId;
                    return {
                        div: [
                            { div: [
                                `fx-effect #${idx} `,
                                { code: execId, $: { style: { color: '#9AE6B4' } } }
                                ],
                                $: {
                                    id: `blooky-debug-fx-effect-${idx}`,
                                    style: { fontSize: '12px' }
                                }
                            },
                            { div: [
                                { button: "Pause", $: { type: "button", dataset: { exec: execId, action: "pause" } } },
                                { button: "Resume", $: { type: "button", dataset: { exec: execId, action: "resume" } } },
                                { button: "Step Into", $: { type: "button", dataset: { exec: execId, action: "step-into" } } },
                                { button: "Step Over", $: { type: "button", dataset: { exec: execId, action: "step-over" } } }
                                ],
                                $: { 
                                    id: `blooky-debug-fx-effect-${idx}-controls`,
                                    style: { marginTop: '4px' },
                                    onclick: clickToDebugAction
                                }
                            }
                        ],
                        $: {
                            style: { marginTop: '6px' }
                        }
                    };
                } catch(e) {
                // prepare may fail if context missing; ignore
                }
            })
        })(effectMutations)
    );

    const panel = prime(()=>({
      div: [
        { strong: "Blooky Debug" },
        { div: $effectElements, $: { id: "blooky-debug-list" } }
      ],
      $: {
        id: 'blooky-debug-panel',
        style: {
          position: 'fixed',
          right: '12px',
          bottom: '12px',
          background: 'rgba(0,0,0,0.8)',
          color: '#fff',
          padding: '8px',
          borderRadius: '6px',
          zIndex: '99999'
        }
      }
    }))(undefined) as HTMLElement;

    function clickToDebugAction (ev: MouseEvent) {
        const actionable = (ev.target as HTMLElement)?.closest('[data-action]') as HTMLElement | null;
        if(!actionable) return;
        const action = actionable.dataset.action!;
        const actualExecId = actionable.dataset.exec!;

        if(action === 'pause') debugCtrl.pauseExecution(actualExecId);
        if(action === 'resume') debugCtrl.resumeExecution(actualExecId);
        if(action === 'step-into') debugCtrl.stepExecution(actualExecId, 'into');
        if(action === 'step-over') debugCtrl.stepExecution(actualExecId, 'over');
    }
    return panel;

}

export const debugPanel = attachDevtoolsToEffects();

// svg用のスタイル
import "./blooky-devtools.css";
import { DripperStream, DripEffect, MergedStream, Prop, Stream, Vertex } from "./blooky-types";
import { BlookyMutationEvent, JSHTMLNodeSource } from "./blooky-fv-types";

// グラフ描画
function dumpGraphDOT(entries: Record<string, Stream<any> | Prop<any> | unknown>, graphAttrs: Record<string,string> = { rankdir: "LR" }): string {
  const vertex_map: [string, Vertex|Prop<any>|unknown][] = Object.entries(entries).map(([k,v])=> [k, isStream(v) ? vertex(v) : v]);

  const names = new WeakMap(vertex_map.map(([k,v])=>[Object(v),k]));
  const visited = new WeakMap<any, string>(); // obj → nodeId
  const edges: string[] = [];
  const nodes: string[] = [];
  let counter = 0;

  function addNode(label: string, o: { [key:string]: any }) {
    const id = `n${counter++}`;
    const attrs : string[] = [`label="${label}"`];
    if(o) attrs.push(...Object.entries(o).map(([k,v])=>`${k}="${v}"`));
    nodes.push(`${id} [${attrs.join(" ")}]`);
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
      const value = obj();
      let valueLabel: string;
      switch(typeof value) {
        case "symbol": valueLabel = "symbol(" + value.description + ")"; break;
        case "string": valueLabel = `\\"${value.replaceAll('"','\\"')}\\"`; break;
        default: valueLabel = value + ""; break;
      }
      const id = addNode(label + "|" + valueLabel, { 
        id: label,
        shape: "record", 
        class: "prop " + (value === null ? "null" : typeof value)
      });
      visited.set(obj, id);
      return id;
    }

    if(!isVertex(obj)) {
      const id = addNode(label, { id: names.get(obj) || "unknown", shape: "circle" });
      visited.set(obj, id);
      return id;
    }

    const nodeAttr = names.has(obj)
      ? {
        id: "node-" + label,
        shape: getShape(obj.sourceStream)
      }
      : {
        shape: "point"
      };
      
    const id = addNode(label, nodeAttr);
    visited.set(obj, id);

    const next = [...obj.next??[],...obj.lazyNext??[]];
    if (next) edges.push(...next.map((target)=>{
      const targetLabel = names.get(target) || "Stream";
      const targetId = visit(target, targetLabel);
      return `${id} -> ${targetId}`;
    }));
    const props = obj.props;
    if(props) edges.push(...props.map((p) => `${id} -> ${visit(p, names.get(p) || "none")}`));
    return id;
  }

  vertex_map.forEach(([name,streamOrProp]) => {
    visit(streamOrProp as Vertex|Prop<any>, name);
  })


  const digraph_attrs = Object.entries(graphAttrs).map((v)=>v.join("=")).join(";\n");
  return `digraph BlookyGraph {\ngraph [\n${digraph_attrs}\n];\n${nodes.join("\n")}\n${edges.join("\n")}\n}`;
}

// dripと同様の処理を、全ての関連フローを記録してグラフ生成する
const dripGraph = <A>(value: A) => (dripper: DripperStream<A>) : DripEffect<A> & { streams: Map<Stream<any>,any> } => {
    const lazy = new Map<Vertex,any[]>();
    const streams = new Map<Stream<any>, any>();
    const effects = new Map<Prop<any>,any>();
    const walk = (v:any) => (vert:Vertex) => {
        streams.set(vert.sourceStream,v);
        vert.props?.forEach((p)=>effects.set(p, v));
        if(vert.lazyNext) vert.lazyNext.forEach((lazySource)=>{
            if(lazy.has(lazySource))
                lazy.get(lazySource)!.push(v);
            else
                lazy.set(lazySource, [v]);
        });
        if(vert.next?.length) 
            vert.next
              .filter(({sourceStream}) => !("filterFn" in sourceStream) || sourceStream.filterFn(v))
              .forEach((s) => walk("mapFn" in s.sourceStream ? s.sourceStream.mapFn(v) : v)(s));
    };

    walk(value)(vertex(dripper));
    while(lazy.size) {
        const entries = [...lazy];
        lazy.clear();
        entries.forEach(([s,v])=>walk(v.reduce((s.sourceStream as MergedStream<any>).reduceFn))(s));
    }

    return { dripper, value, streams, effects };
}

export {dumpGraphDOT,dripGraph};

