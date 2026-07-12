import { JSHTML_ATTR_HANDLER, JSHTML_ELEMENT_HANDLER, JSHTMLAttrRuntime } from "./blooky-fv";
import {
  fx,
  query,
  ref,
} from "./blooky-fx";
import { FxNote, AppContext, FxRef, ExecutionConfig, ExecutionContext, YieldConditionRef, YieldLocator, FxRef as FxRefType } from "./blooky-fx-types";
import { isFxRefKey } from "./runtime/engine";

type FxDomErrorCode =
  | "INVALID_JSON_ARGUMENT"
  | "MISSING_REQUIRED_ATTRIBUTE"
  | "INVALID_JSON_YIELD_VALUE"
  | "MISSING_CONTEXT_USAGE_KEY"
  | "UNAUTHORIZED_CONTEXT_ACCESS"
  | "CUSTOM_ELEMENT_ALREADY_DEFINED";

const createFxDomError = (
  code: FxDomErrorCode,
  message: string,
  detail?: Record<string, unknown>
): Error & { detail?: Record<string, unknown> } => {
  const error = new Error(`[fxdom:${code}] ${message}`);
  (error as Error & { code?: string }).code = code;
  if (detail) {
    (error as Error & { detail?: Record<string, unknown> }).detail = detail;
  }
  return error;
};

// ---- 抽象基底クラス ----

export const defaultFxStylesheet = new CSSStyleSheet();
defaultFxStylesheet.replaceSync(":host { display: none; }");

/**
 * note ↔ element の受動的対応表。
 *
 * 公開契約は getElementForNote() のみ。データ構造（WeakMapであること）や
 * 更新タイミングは非公開の実装詳細であり、将来変更されても
 * getElementForNote() のシグネチャが安定している限り消費側は影響を受けない。
 */
const noteElementMap = new WeakMap<FxNote, EffectElement>();

export function getElementForNote(note: FxNote): EffectElement | undefined {
  return noteElementMap.get(note);
}

/**
 * 副作用フローのノード (FxNote) を表現するすべてのカスタム要素の抽象基底クラス。
 */
export abstract class EffectElement extends HTMLElement {

  /**
   * このDOM要素に対応するFxNoteを構築する。純粋な変換のみを行い、
   * 副作用（記録・登録など）を持ってはならない。
   * 記録は公開テンプレートメソッド toFxNote() の責務。
   */
  protected abstract buildFxNote(): FxNote;

  /**
   * このDOM要素に対応するFxNoteオブジェクトを生成して返す。
   * 生成結果は自動的に note↔element 対応表へ記録される。
   * サブクラスはこのメソッドをオーバーライドしない（buildFxNote を実装する）。
   */
  toFxNote(): FxNote {
    const note = this.buildFxNote();
    noteElementMap.set(note, this);
    return note;
  }

  /**
   * 子要素を走査し、対応するFxNoteの配列を生成する。
   * 子も必ず公開 toFxNote() 経由になるため、対応表への登録漏れが起きない。
   * @returns 子要素から生成されたFxNoteの配列
   */
  protected childrenToFxNotes(): FxNote[] {
    return Array.from(this.children)
      .filter((n): n is EffectElement => n instanceof EffectElement)
      .map((n) => n.toFxNote());
  }

  connectedCallback(): void {
    const shadow = (this.shadowRoot || this.attachShadow({ mode: "open" }));
    shadow.replaceChildren(document.createElement("slot"));
    shadow.adoptedStyleSheets = [defaultFxStylesheet];
  }

}

// ---- 合成可能な instrumentation フック ----

export type LifecycleHooks<T extends EffectElement = EffectElement> = {
  observedAttributes?: string[];
  connected?: (el: T) => void;
  attributeChanged?: (el: T, name: string, oldValue: string | null, newValue: string | null) => void;
};

/**
 * EffectElement サブクラスへの合成可能な instrumentation 拡張点。
 * 消費側（例: devtools）はクラスを継承せず、フック関数を渡すだけで
 * connectedCallback / attributeChangedCallback に処理を差し込める。
 * fxdom の実装（メソッド解決順序やクラス階層）を知る必要がない。
 */
export function withLifecycleHooks<T extends typeof EffectElement>(
  Base: T,
  hooks: LifecycleHooks<InstanceType<T>>
): T {
  const BaseClass = Base as any;
  return class extends BaseClass {
    static get observedAttributes() {
      const parentAttrs = BaseClass.observedAttributes ?? [];
      return [...new Set([...parentAttrs, ...(hooks.observedAttributes ?? [])])];
    }
    connectedCallback() {
      super.connectedCallback();
      hooks.connected?.(this as InstanceType<T>);
    }
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
      if ('attributeChangedCallback' in BaseClass.prototype) {
        super.attributeChangedCallback(name, oldValue, newValue);
      }
      hooks.attributeChanged?.(this as InstanceType<T>, name, oldValue, newValue);
    }
  } as unknown as T;
}

// ---- コンテキストバインディング ----

// コンテキストキーの逆引きルックアップをキャッシュするためのWeakMap
const CONTEXT_MEMO = new WeakMap<AppContext,AppContext>();

/**
 * 値からコンテキストキーへの逆引きを行う関数を返す。
 * @param value 逆引きしたい値
 * @returns AppContextを受け取り、対応するキーを返す関数（見つからなければnull）
 */
const reverseLookup = (value: unknown) => (ctx: AppContext) => {
  if(!CONTEXT_MEMO.has(ctx)) CONTEXT_MEMO.set(ctx, new Map(Object.entries(ctx).map(([k,v])=>[v,k])));
  const reversed = CONTEXT_MEMO.get(ctx)!;
  return reversed.has(value) ? reversed.get(value) : null;
}

/**
 * jshtmlの属性ハンドラ。属性値がコンテキストからの直接マッピングだった場合、
 * 属性値にコンテキストのキー自体を用いるように変換する。
 * @param runtime JSHTMLAttrRuntimeオブジェクト
 * @returns 処理が完了した場合はfalse、通常の処理を続ける場合はtrue
 */
const attrValueToContextKey = ({target,name,value,context}: JSHTMLAttrRuntime<any>): boolean | void => {
  if(!context) return true;
  const context_key = reverseLookup(value)(context);
  // コンテキストキーとして逆引きできたら、DOM属性をキーに上書きし、後続の処理をスキップする
  if(!context_key) return true;
  target.setAttribute(name, context_key);
  return false;
};

// ---- コア要素 ----

/**
 * 連続実行 (fx.sequence) を表すカスタム要素。
 * 子ノードを順番に実行する。
 */
class FxSequenceElement extends EffectElement {
  protected buildFxNote(): FxNote {
    return fx.sequence(this.childrenToFxNotes());
  }
}

/**
 * 並行実行 (fx.parallel) を表すカスタム要素。
 * すべての子ノードを並行して実行し、すべてが完了するのを待つ。
 */
class FxParallelElement extends EffectElement {
  protected buildFxNote(): FxNote {
    return fx.parallel(this.childrenToFxNotes());
  }
}

/**
 * 競合実行 (fx.race) を表すカスタム要素。
 * 子ノードを並行して実行し、最初に完了したノードの結果を返す。
 */
class FxRaceElement extends EffectElement {
  protected buildFxNote(): FxNote {
    return fx.race(this.childrenToFxNotes());
  }
}

/**
 * 待機 (fx.wait) を表すカスタム要素。
 * `timer` 属性または `until` 属性で指定された条件が満たされるまでフローをブロックする。
 */
class FxWaitElement extends EffectElement {

  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { until: attrValueToContextKey }

  protected buildFxNote(): FxNote {
    const timerAttr = this.getAttribute("timer");
    let timer : FxRef<number>|undefined = undefined;
    
    if(timerAttr !== null) {
      // timer属性が数値の場合、静的な値を返すPropとする
      // isFiniteでtrueでなければ参照とみなしてrefを返す
      const n = Number(timerAttr);
      timer = Number.isFinite(n) ? () => n : ref<number>(timerAttr);
    }
      
    // until属性がある場合、コンテキストへの参照とする
    const until = this.hasAttribute("until") ? ref<boolean>(this.getAttribute("until")!) : undefined;
    
    return fx.wait({timer,until,id:this.id});
  }
}

/**
 * 関数呼び出し (fx.call) を表すカスタム要素。
 * `fn` 属性で指定されたコンテキスト内の関数を実行する。
 */
class FxCallElement extends EffectElement {

  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { action: attrValueToContextKey, input: attrValueToContextKey, done: attrValueToContextKey }

  protected buildFxNote(): FxNote {
    const actionAttr = this.getAttribute("action");
    // action属性がなければ何もしない
    if (!actionAttr) return fx.none();

    let input: FxRef<any> = undefined;
    
    // input属性があればコンテキスト参照として設定
    if(this.hasAttribute("input")) {
      input = ref(this.getAttribute("input")!);
    // テキストコンテンツがあればJSONとしてパースして引数に設定
    } else if(/\S/.test(this.textContent)) {
      const rawText = this.textContent.trim();
      input = () => {
        try {
          return JSON.parse(rawText);
        } catch (e) {
          // JSONパースエラーは structure エラーとして報告
          throw createFxDomError(
            "INVALID_JSON_ARGUMENT",
            "Invalid JSON content provided in <fx-call> body.",
            {
              expected: "JSON",
              actual: rawText,
              suggestions: ["Ensure the element body contains valid JSON, or use the 'input' attribute for context reference."],
            }
          );
        }
      }
    }
    
    return fx.call(ref(actionAttr), {
      input,
      done: this.hasAttribute("done") ? ref(this.getAttribute("done")!) : undefined,
      id: this.id,
    });
  }
}

/**
 * 条件分岐 (fx.condition) を表すカスタム要素。
 * `test` 属性の評価結果に基づいて、`then` または `else` スロットの内容を実行する。
 */
class FxIfElement extends EffectElement {
  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { test: attrValueToContextKey }
  
  protected buildFxNote(): FxNote {
    const testAttr = this.getAttribute("test");
    if (!testAttr) return fx.none();

    const thenNode = this.querySelector('[slot="then"]') as EffectElement | null;
    const elseNode = this.querySelector('[slot="else"]') as EffectElement | null;
    
    // test属性をrefとして渡すだけ
    const condRef = ref<boolean>(testAttr);

    if (thenNode) {
      // thenNode/elseNode は公開 toFxNote() 経由 → 自動で対応表へ登録される
      return fx.condition(condRef, thenNode.toFxNote(), elseNode?.toFxNote());
    } else {
      // スロットがない場合は、直接の子ノードをthenノードとして使用
      const childrenFx = this.childrenToFxNotes();
      return fx.condition(condRef, childrenFx.length ? fx.sequence(childrenFx) : fx.none());
    }
  }
}

/**
 * 分岐処理 (fx.switch) を表すカスタム要素。
 * `by` 属性で指定された値に基づいて、対応する `slot` の子ノードを実行する。
 */
class FxSwitchElement extends EffectElement {
  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { by: attrValueToContextKey }
  
  protected buildFxNote(): FxNote {
    const byAttr = this.getAttribute("by");
    if (!byAttr) return fx.none();

    const cases = new Map(
      Array.from(this.children)
        .filter((e): e is EffectElement => e instanceof EffectElement && e.hasAttribute("slot"))
        .map(e => [e.getAttribute("slot")!, e.toFxNote()]) // slot名をcaseキーとする
    );
    
    const defaultNode = cases.get("default");
    cases.delete("default"); // defaultは特別扱い

    return fx.switch(ref(byAttr), cases, defaultNode);
  }
}

/**
 * ループ実行 (fx.loop) を表すカスタム要素。
 * `while` 属性の条件が満たされている間、子ノードを実行し続ける。
 */
class FxLoopElement extends EffectElement {
  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { while: attrValueToContextKey }

  protected buildFxNote(): FxNote {
    const whileAttr = this.getAttribute("while");
    if (!whileAttr) return fx.none();
    
    const options: {
      maxIterations?: number;
      maxDuration?: number;
    } = {};
    
    // 最大反復回数
    const maxIterAttr = this.getAttribute("max-iterations");
    if (maxIterAttr === "infinity") {
      options.maxIterations = Infinity;
    } else if (maxIterAttr) {
      const num = parseInt(maxIterAttr);
      if (!isNaN(num) && num > 0) options.maxIterations = num;
    }
    
    // 最大継続時間 (ミリ秒)
    const maxDurAttr = this.getAttribute("max-duration");
    if (maxDurAttr) {
      const num = parseInt(maxDurAttr);
      if (!isNaN(num) && num > 0) options.maxDuration = num;
    }
    
    return fx.loop(ref<boolean>(whileAttr), fx.sequence(this.childrenToFxNotes()), options);
  }

}

/**
 * 実行コンテキストへの値の反映 (fx.yield) を表すカスタム要素。
 * 現在の実行コンテキストに値を反映させ、外部からの制御を待つ。
 */
class FxYieldElement extends EffectElement {
  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = {
    for: attrValueToContextKey,
    input: attrValueToContextKey,
    done: attrValueToContextKey
  }
  
  protected buildFxNote(): FxNote {
    const id = this.id;
    const forAttr = this.getAttribute("for");
    
    // for属性は必須
    if (!forAttr) {
      throw createFxDomError("MISSING_REQUIRED_ATTRIBUTE", "<fx-yield> requires a 'for' attribute to specify the yield key.", {
        attribute: "for",
        suggestions: ["Add the 'for' attribute to specify which key to yield to."],
        expected: "string (context key)",
        actual: "missing"
      });
    }
    
    let value: undefined | FxRef<any> = undefined;
    
    if(this.hasAttribute("input")) {
      value = ref(this.getAttribute("input")!);
    } else if(/\S/.test(this.textContent)) {
      const rawText = this.textContent.trim();
      value = () => {
        try {
          return JSON.parse(rawText);
        } catch (e) {
          // JSONパースエラーは structure エラーとして報告
          throw createFxDomError(
            "INVALID_JSON_YIELD_VALUE",
            "Invalid JSON content provided in <fx-yield> body.",
            {
              expected: "JSON",
              actual: rawText,
              suggestions: ["Ensure the element body contains valid JSON, or use the 'value' attribute for context reference."],
            }
          );
        }
      }
    }
    
    return fx.yield({
      score: ref<string>(forAttr),
      input: value,
      done: this.hasAttribute("done") ? ref(this.getAttribute("done")!) : undefined,
      id
    });
  }
}

/**
 * フローからの戻り値の設定 (fx.return) を表すカスタム要素。
 * このノードが実行されると、現在のFxNote実行を終了し、値を返す。
 */
class FxReturnElement extends EffectElement {
  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { value: attrValueToContextKey }
  
  protected buildFxNote(): FxNote {
    return fx.return(this.hasAttribute("value") ? ref(this.getAttribute("value")!) : undefined);
  }
}

/**
 * Flow定義 (fx-flow) を表すカスタム要素。
 * fx-yield により起動された score の展開先ルート。
 */
class FxFlowElement extends EffectElement {

  /** コンテキストが利用できない場合の内部シンボル */
  static noneResult = Symbol("none")

  /** この要素が保持するコンテキスト */
  protected context: Record<string, any> = {};
  
  /**
   * 親の FxFlowElement または FxEffectElement を検索する。
   */
  parentContext() : FxFlowElement | null {
    return this.parentElement ? this.parentElement.closest("fx-flow,fx-effect") : null;
  }

  protected buildFxNote(): FxNote {
    const nodes = this.childrenToFxNotes();
    // 子ノードの有無に応じて、単一ノード、シーケンス、または none を選択
    const child = !nodes.length
      ? fx.none() 
      : nodes.length === 1
      ? nodes[0]
      : fx.sequence(nodes);
      
    return fx.flow(this.context, child, this.id);
  }

  /**
   * コンテキストを設定する。`use` 属性がある場合、必要なキーがすべて含まれているか検証する。
   * @param ctx 設定するコンテキストオブジェクト
   */
  setContext(ctx: Record<string, any>) {
    if(this.hasAttribute("use")) {
      const useAttr = this.getAttribute("use")!;
      const useList = useAttr.replace(/\s+/g,"").split(",");
      // use属性で指定されているがctxに存在しないキーをチェック
      const noExist = useList.filter((use)=>!(use in ctx));
      if(noExist.length) {
        throw createFxDomError(
          "MISSING_CONTEXT_USAGE_KEY",
          `[fx-flow] Invalid context: keys "${noExist.join(", ")}" are required by 'use' attribute but not contained in the input context.`,
          {
            attribute: "use",
            suggestions: ["Ensure the context passed to the element contains all keys listed in the 'use' attribute."],
            expected: useList.join(", "),
            actual: Object.keys(ctx).join(", ")
          }
        );
      }
    }
    this.context = ctx;
  }

  /**
   * キーがこの要素の `use` 属性で許可されているかを確認する。
   * @param key チェックするコンテキストキー
   * @returns 許可されていればtrue
   */
  containedUseAttr(key: string) {
    if(!this.hasAttribute("use")) return false;
    const useAttr = this.getAttribute("use")!;
    if(useAttr === "*") return true; // * は全てを許可
    const useList = useAttr.replace(/\s+/g,"").split(",");
    return useList && useList.includes(key);
  }

  /**
   * 自分からルートまでコンテキストの値を検索する。
   * @param key 検索するコンテキストキー
   * @param requiredUseAttr `use` 属性によるチェックを強制するかどうか
   * @returns 見つかった値、またはundefined
   */
  getContextValue(key: string, requiredUseAttr = false) : unknown {
    // 1. まず自分のコンテキストを確認
    if (key in this.context) {
      // use属性によるチェックが必要であれば実行
      if(requiredUseAttr === true && !this.containedUseAttr(key)) {
        throw createFxDomError(
          "UNAUTHORIZED_CONTEXT_ACCESS",
          `[fx-flow] Invalid context key: "${key}" is not contained in the 'use' attribute for required access.`,
          {
            constraint: `Key "${key}" must be listed in 'use' attribute.`,
            property: key,
            suggestions: ["Add the key to the 'use' attribute if it should be accessed here."]
          }
        );
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


/**
 * フロー宣言のルートとなるカスタム要素。
 * contextの提供機能を有する。
 */
class FxEffectElement extends FxFlowElement {
  
  [JSHTML_ELEMENT_HANDLER](context?: AppContext) {
    if (context) this.setContext(context);
  }

  connectedCallback(): void {
    super.connectedCallback();
  }

}

/**
 * カスタム要素を定義するためのヘルパーオブジェクト。
 */
export const fxdom = {

  /**
   * 指定されたタグ名マップに基づいてカスタム要素を定義する。
   * @param tagNameMap タグ名とEffectElementクラスのマップ
   */
  defineEffectElements: (tagNameMap: Record<string,typeof EffectElement> = EffectElementTagNameMap) => {
    // 引数でEffectElementに縛るため、defineは型キャストで通す
    Object.entries(tagNameMap).forEach(([tag,cls])=>{
      if (customElements.get(tag)) {
          // カスタム要素が既に定義されている場合は dev-config エラー
          throw createFxDomError(
            "CUSTOM_ELEMENT_ALREADY_DEFINED",
            `Custom element "${tag}" is already defined.`,
            {
              suggestions: ["Ensure fxdom.defineEffectElements() is only called once."],
              nodeType: tag,
            }
          );
      }
      customElements.define(tag,cls as unknown as CustomElementConstructor)
    });
  }

}

export const executeByElement = (root: FxEffectElement, app: AppContext = {}, ctx?: Partial<ExecutionConfig>) => {
  if(root.tagName.toLowerCase() !== "fx-effect")
    throw new Error("[ExecuteError] executeByElement needs `fx-effect` Element");
  else if(!root.isConnected)
    throw new Error("[ExecuteError] Element is not connected");
  return query(root.toFxNote(), app, ctx);
};

/**
 * 組み込みのEffectElementタグ名とクラスのマップ
 */
export const EffectElementTagNameMap = {
  // score-fx対応要素
  "fx-sequence": FxSequenceElement,
  "fx-parallel": FxParallelElement,
  "fx-race": FxRaceElement,
  "fx-wait": FxWaitElement,
  "fx-call": FxCallElement,
  "fx-if": FxIfElement,
  "fx-switch": FxSwitchElement,
  "fx-loop": FxLoopElement,
  "fx-yield": FxYieldElement,
  "fx-return": FxReturnElement,
  // コンテキスト適用要素
  "fx-flow": FxFlowElement,
  "fx-effect": FxEffectElement,
}

// elements
export {FxCallElement,FxWaitElement,FxEffectElement,FxIfElement,FxParallelElement,FxRaceElement,FxLoopElement,FxSequenceElement,FxSwitchElement,FxFlowElement as FxFlowElement,FxReturnElement};
