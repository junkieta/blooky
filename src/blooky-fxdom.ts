import { jshtml, JSHTML_ATTR_HANDLER, JSHTML_ELEMENT_HANDLER, JSHTMLAttrRuntime } from "./blooky-dom";
import { blooky } from "./blooky-fp";
import { 
  prepare, 
  execute, 
  fx, 
  ref,
} from "./blooky-fx";
import { CollapseObserver, Dripper } from "./blooky-types";
import { FxNode, ExecContext, PreparedFx, ExecutionHandle, AppContext, FxRef } from "./fx/types";

// ---- 抽象基底クラス ----

/**
 * 副作用フローのノード (FxNode) を表現するすべてのカスタム要素の抽象基底クラス。
 */
export abstract class EffectElement extends HTMLElement {

  /**
   * このDOM要素に対応するFxNodeオブジェクトを生成して返す。
   */
  abstract toFxNode(): FxNode;

  /**
   * 子要素を走査し、対応するFxNodeの配列を生成する。
   * @returns 子要素から生成されたFxNodeの配列
   */
  protected childrenToFxNodes(): FxNode[] {
    return Array.from(this.children)
      .filter((n): n is EffectElement => n instanceof EffectElement)
      .map((n) => n.toFxNode());
  }
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
  toFxNode(): FxNode {
    return fx.sequence(this.childrenToFxNodes());
  }
}

/**
 * 並行実行 (fx.parallel) を表すカスタム要素。
 * すべての子ノードを並行して実行し、すべてが完了するのを待つ。
 */
class FxParallelElement extends EffectElement {
  toFxNode(): FxNode {
    return fx.parallel(this.childrenToFxNodes());
  }
}

/**
 * 競合実行 (fx.race) を表すカスタム要素。
 * 子ノードを並行して実行し、最初に完了したノードの結果を返す。
 */
class FxRaceElement extends EffectElement {
  toFxNode(): FxNode {
    return fx.race(this.childrenToFxNodes());
  }
}

/**
 * 待機 (fx.wait) を表すカスタム要素。
 * `ms` 属性または `until` 属性で指定された条件が満たされるまでフローをブロックする。
 */
class FxWaitElement extends EffectElement {

  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { until: attrValueToContextKey }

  toFxNode(): FxNode {
    const msAttr = this.getAttribute("ms");
    let ms : FxRef<number>;
    
    // ms属性がない場合、待機時間は0とする
    if(!msAttr)
      ms = () => 0;
    // ms属性が数値の場合、静的な値を返すPropとする
    else if(!isNaN(parseInt(msAttr)))
      ms = () => parseInt(msAttr);
    // ms属性が文字列の場合、コンテキストへの参照とする
    else
      ms = ref<number>(msAttr);
      
    // until属性がある場合、コンテキストへの参照とする
    const until = this.hasAttribute("until") ? ref<boolean>(this.getAttribute("until")!) : undefined;
    
    return fx.wait({ms,until,id:this.id});
  }
}

/**
 * 関数呼び出し (fx.call) を表すカスタム要素。
 * `fn` 属性で指定されたコンテキスト内の関数を実行する。
 */
class FxCallElement extends EffectElement {

  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { fn: attrValueToContextKey, arg: attrValueToContextKey }

  toFxNode(): FxNode {
    const fnAttr = this.getAttribute("fn");
    // fn属性がなければ何もしない
    if (!fnAttr) return fx.none();

    let arg: FxRef<any> = undefined;
    
    // arg属性があればコンテキスト参照として設定
    if(this.hasAttribute("arg")) {
      arg = ref(this.getAttribute("arg")!);
    // テキストコンテンツがあればJSONとしてパースして引数に設定
    } else if(/\S/.test(this.textContent)) {
      const rawText = this.textContent.trim();
      arg = () => {
        try {
          return JSON.parse(rawText);
        } catch (e) {
          // JSONパースエラーは structure エラーとして報告
          throw blooky.error("structure", {
            code: "INVALID_JSON_ARGUMENT",
            expected: "JSON",
            message: `Invalid JSON content provided in <fx-call> body.`,
            actual: rawText,
            suggestions: ["Ensure the element body contains valid JSON, or use the 'arg' attribute for context reference."],
          });
        }
      }
    }
    
    return fx.call(ref(fnAttr), {
      arg: arg,
      // catcher属性があれば、エラーハンドラとしてコンテキスト参照を設定
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

/**
 * 外部ソースからフロー定義を読み込み、展開するカスタム要素。
 * @note FxFlowからFxIncludeにリネームされました。
 */
class FxIncludeElement extends EffectElement {

  // 'src'属性の変更を監視対象に含める
  static observedAttributes = ['src'];
  
  toFxNode(): FxNode {
    const children = this.childrenToFxNodes();
    // 子ノードが複数あればsequence、1つならそのまま、なければnone
    const node = children.length > 1
      ? fx.sequence(children)
      : children[0] ?? fx.none();
      
    // idがあればノードに設定
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
          originalError: new Error(response.statusText),
          suggestions: ["Check the network path and ensure the source exists and returns a 200 OK status."]
        });
        
        const contentJson = await response.json();

        template = this.ownerDocument.createElement("template") as HTMLTemplateElement;
        // JSONレスポンスをJSHTMLに渡してDOMフラグメントを生成
        template.content.append(jshtml(contentJson));
        FLOW_TEMPLATE_CACHE.set(src, template);
      } catch (error) {
        // 元のエラーが blooky.error でない場合は、blooky.errorにラップする
        const blookyError = (error.category) ? error : blooky.error("user", {
          code: "INCLUDE_PROCESSING_ERROR",
          message: `Error processing include from "${src}"`,
          element: this,
          originalError: error,
          suggestions: ["Verify the content of the remote file is valid JSHTML JSON structure."]
        });
        
        // エラーをコンソールに出力
        console.error(`Error processing <fx-include src="${src}">:`, blookyError);

        // コンテンツをクリア
        this.replaceChildren(); 
        
        return; // エラー処理を完結させ、外に例外を伝播させない        
      }
    }

    // テンプレートの内容を複製して自身の子要素に置き換える
    const clonedContent = template.content.cloneNode(true);
    this.replaceChildren(clonedContent);
  }
}

/**
 * 条件分岐 (fx.condition) を表すカスタム要素。
 * `when` 属性の評価結果に基づいて、`then` または `else` スロットの内容を実行する。
 */
class FxIfElement extends EffectElement {
  /** @inheritdoc */
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
      // スロットがない場合は、直接の子ノードをthenノードとして使用
      const childrenFx = this.childrenToFxNodes();
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
  
  toFxNode(): FxNode {
    const byAttr = this.getAttribute("by");
    if (!byAttr) return fx.none();

    const cases = new Map(
      Array.from(this.children)
        .filter((e): e is EffectElement => e instanceof EffectElement && e.hasAttribute("slot"))
        .map(e => [e.getAttribute("slot")!, e.toFxNode()]) // slot名をcaseキーとする
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

  toFxNode(): FxNode {
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
    
    return fx.loop(ref<boolean>(whileAttr), fx.sequence(this.childrenToFxNodes()), options);
  }

}

/**
 * Dripper（ストリーム）からの値の取得 (fx.collapse) を表すカスタム要素。
 * ストリームから値を取得し、フローを再開する。
 */
class FxCollapseElement extends EffectElement {
  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { dripper: attrValueToContextKey, value: attrValueToContextKey }
  
  toFxNode(): FxNode {
    const streamKey = this.getAttribute("dripper");
    if (!streamKey) return fx.none();

    const valueKey = this.getAttribute("value");
    // value属性がある場合、そのコンテキストキーの値をストリームに流す
    if(valueKey) return fx.collapse(ref<any>(valueKey), ref<Dripper<any>>(streamKey));

    // それ以外の場合、textContentを値として扱う
    let data: any;
    const raw = this.textContent.trim();
    if(raw.length > 0) {
      try {
        data = JSON.parse(raw);
      } catch(e) {
        // JSONパースエラーは structure エラーとして報告
        throw blooky.error("structure", {
          code: "INVALID_JSON_COLLAPSE_VALUE",
          expected: "JSON",
          message: `Invalid JSON content provided in <fx-collapse> body.`,
          actual: raw,
          suggestions: ["Ensure the element body contains valid JSON, or use the 'value' attribute for context reference."],
        });
      }
    }
    
    return fx.collapse(data, ref<Dripper<typeof data>>(streamKey));
  }
}


/**
 * 実行コンテキストへの値の反映 (fx.yield) を表すカスタム要素。
 * 現在の実行コンテキストに値を反映させ、外部からの制御を待つ。
 */
class FxYieldElement extends EffectElement {
  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { for: attrValueToContextKey }
  
  toFxNode(): FxNode {
    const id = this.id;
    const forAttr = this.getAttribute("for");
    
    // for属性は必須
    if (!forAttr) {
      throw blooky.error("structure", {
        code: "MISSING_REQUIRED_ATTRIBUTE",
        message: `<fx-yield> requires a 'for' attribute to specify the yield key.`,
        attribute: "for",
        suggestions: ["Add the 'for' attribute to specify which key to yield to."],
        expected: "string (context key)",
        actual: "missing"
      });
    }
    
    let value: undefined | FxRef<any> = undefined;
    
    if(this.hasAttribute("value")) {
      value = ref(this.getAttribute("value")!);
    } else if(/\S/.test(this.textContent)) {
      const rawText = this.textContent.trim();
      value = () => {
        try {
          return JSON.parse(rawText);
        } catch (e) {
          // JSONパースエラーは structure エラーとして報告
          throw blooky.error("structure", {
            code: "INVALID_JSON_YIELD_VALUE",
            expected: "JSON",
            message: `Invalid JSON content provided in <fx-yield> body.`,
            actual: rawText,
            suggestions: ["Ensure the element body contains valid JSON, or use the 'value' attribute for context reference."],
          });
        }
      }
    }
    
    return fx.yield({ for: ref<string>(forAttr), value, id });
  }
}

/**
 * フローからの戻り値の設定 (fx.return) を表すカスタム要素。
 * このノードが実行されると、現在のFxNode実行を終了し、値を返す。
 */
class FxReturnElement extends EffectElement {
  /** @inheritdoc */
  static [JSHTML_ATTR_HANDLER] = { value: attrValueToContextKey }
  
  toFxNode(): FxNode {
    return fx.return(this.hasAttribute("value") ? ref(this.getAttribute("value")!) : undefined);
  }
}

/**
 * コンテキスト定義 (fx.context) を表すカスタム要素。
 * 子ノードの実行に必要なコンテキスト（変数や関数）を定義し、提供する。
 */
class FxContextElement extends EffectElement {

  /** コンテキストが利用できない場合の内部シンボル */
  static noneResult = Symbol("none")

  /** この要素が保持するコンテキスト */
  protected context: Record<string, any> = {};
  
  /**
   * 親の FxContextElement または FxEffectElement を検索する。
   */
  parentContext() : FxContextElement | null {
    return this.parentElement ? this.parentElement.closest("fx-context,fx-effect") : null;
  }

  toFxNode(): FxNode {
    const nodes = this.childrenToFxNodes();
    // 子ノードの有無に応じて、単一ノード、シーケンス、または none を選択
    const child = !nodes.length
      ? fx.none() 
      : nodes.length === 1
      ? nodes[0]
      : fx.sequence(nodes);
      
    return fx.context(this.context, child, this.id);
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
        throw blooky.error("structure", {
          code: "MISSING_CONTEXT_USAGE_KEY",
          message: `[fx-context] Invalid context: keys "${noExist.join(", ")}" are required by 'use' attribute but not contained in the input context.`,
          attribute: "use",
          suggestions: ["Ensure the context passed to the element contains all keys listed in the 'use' attribute."],
          expected: useList.join(", "),
          actual: Object.keys(ctx).join(", ")
        });
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
        throw blooky.error("constraint", {
          code: "UNAUTHORIZED_CONTEXT_ACCESS",
          message: `[fx-context] Invalid context key: "${key}" is not contained in the 'use' attribute for required access.`,
          constraint: `Key "${key}" must be listed in 'use' attribute.`,
          property: key,
          suggestions: ["Add the key to the 'use' attribute if it should be accessed here."]
        });
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
 * フロー実行の起点 (prepare/execute) となるカスタム要素。
 * `ignite` 属性によって実行タイミングを制御する。
 */
class FxEffectElement extends FxContextElement {

  /** 監視対象の属性 */
  static observedAttributes = ["ignite"];

  /** 実行コンテキストの追加設定 */
  protected _execContext?: Partial<ExecContext>
  /** 準備されたフロー */
  protected _preparedFx?: PreparedFx
  /** 実行ハンドル */
  protected _handle?: ExecutionHandle

  /**
   * JSHTMLによってコンテキストが設定された際に呼び出されるハンドラ。
   * @param context AppContext
   */
  [JSHTML_ELEMENT_HANDLER](context?: AppContext) {
    if(context) this.setContext(context);
  }

  /**
   * FxNodeを準備し、PreparedFxオブジェクトを生成または取得する。
   * @param force 強制的に再準備するかどうか
   * @returns PreparedFx
   */
  prepare(force = false) {
    if (!force && this._preparedFx) return this._preparedFx;
    return this._preparedFx = prepare(this.toFxNode(), this.context, this._execContext);
  }

  /**
   * 準備されたFxNodeの実行を開始し、ExecutionHandleを返す。
   * 既に実行中のフローがあればキャンセルする。
   * @returns ExecutionHandle
   */
  execute() {
    if(this._handle) this._handle.cancel();
    this._handle = execute(this._preparedFx || this.prepare());
    return this._handle;
  }

  /**
   * `ignite` 属性に基づいてフローの実行を開始する。
   * @param type 実行タイミング ("none", "quantum", "visual", "sequential", "immediate")
   */
  protected igniteFx(type: CollapseObserver | "none") {
    this.prepare();
    switch(type) {
      case "none":
        break;

      case "quantum":
        // 次のマイクロタスクとして実行
        queueMicrotask(this.execute.bind(this));
        break;

      case "visual":
        // 次の描画フレームで実行
        requestAnimationFrame(this.execute.bind(this));
        break;

      case "sequential":
        // 次のタスクとして実行
        setTimeout(this.execute.bind(this));
        break;

      case "immediate":
        // 同期的に実行
        this.execute();
        break;

      default:
        // 不明なignite属性値は user エラーとして報告（警告ではなくエラーとする）
        throw blooky.error("user", {
          code: "UNKNOWN_IGNITE_VALUE",
          message: `Unknown 'ignite' attribute value: "${this.getAttribute("ignite")}"`,
          element: this,
          recoverable: true,
          originalError: null,
          suggestions: ["Use 'none', 'quantum', 'visual', 'sequential', or 'immediate'."],
        });
    }
  }

  connectedCallback() {
    this.igniteFx(!this.hasAttribute("ignite") ? "none" : this.getAttribute("ignite") as CollapseObserver | "none");
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

/**
 * カスタム要素を定義するためのヘルパーオブジェクト。
 */
const fxdom = {

  /**
   * 指定されたタグ名マップに基づいてカスタム要素を定義する。
   * @param tagNameMap タグ名とEffectElementクラスのマップ
   */
  defineEffectElements: (tagNameMap: Record<string,typeof EffectElement> = EffectElementTagNameMap) => {
    // 引数でEffectElementに縛るため、defineは型キャストで通す
    Object.entries(tagNameMap).forEach(([tag,cls])=>{
      if (customElements.get(tag)) {
          // カスタム要素が既に定義されている場合は dev-config エラー
          throw blooky.error("dev-config", {
            code: "CUSTOM_ELEMENT_ALREADY_DEFINED",
            message: `Custom element "${tag}" is already defined.`,
            suggestions: ["Ensure fxdom.defineEffectElements() is only called once."],
            nodeType: tag,
          });
      }
      customElements.define(tag,cls as unknown as CustomElementConstructor)
    });
  }

}

/**
 * 組み込みのEffectElementタグ名とクラスのマップ
 */
const EffectElementTagNameMap = {
  "fx-sequence": FxSequenceElement,
  "fx-parallel": FxParallelElement,
  "fx-race":  FxRaceElement,
  "fx-wait":  FxWaitElement,
  "fx-call":  FxCallElement,
  "fx-include":  FxIncludeElement,
  "fx-if":  FxIfElement,
  "fx-switch":  FxSwitchElement,
  "fx-loop":  FxLoopElement,
  "fx-collapse":  FxCollapseElement,
  "fx-yield": FxYieldElement,
  "fx-context":  FxContextElement,
  "fx-effect":  FxEffectElement,
  "fx-return": FxReturnElement
}

export {FxCallElement,FxWaitElement,FxEffectElement,FxCollapseElement,FxIfElement,FxIncludeElement,FxParallelElement,FxRaceElement,FxLoopElement,FxSequenceElement,FxSwitchElement,FxContextElement,FxReturnElement,fxdom,EffectElementTagNameMap};
