# Blooky Framework APIリファレンス

## 目次
1. [`blooky-fp` - リアクティブコア](#blooky-fp)
2. [`blooky-dom` - DOM構築](#blooky-dom)
3. [`blooky-fx` - 副作用管理](#blooky-fx)
4. [`blooky-fxdom` - 宣言的副作用](#blooky-fxdom)
5. [`blooky-devtools` - 開発ツール](#blooky-devtools)

---

## <a id="blooky-fp"></a>`blooky-fp` - リアクティブコア

### モジュールの役割

`blooky-fp`は、Blookyの全てのリアクティビティを支えるコアモジュールです。プラットフォームに依存せず、データの「流れ」と「状態」を扱うための、純粋で合成可能なプリミティブとオペレーターを提供します。

### 中心となる概念

**`Stream<A>` - イベントの流れ**  
未来に発生する一連のイベントを表現するデータ構造。`Stream`自体は値を持たず、「これから値が流れてくる可能性がある」という**可能性**や**設計図**を定義します。

**`Prop<A>` - 確定した状態**  
`() => A`という形式の、現在の値を返す関数。`Stream`から`hold`や`accum`を通じて生成され、ある時点での**確定した状態**を表現します。

**`DripperStream<A>` - ソースストリーム**  
`Stream`の特殊型で、外部から値を投入（drip）できる起点となるストリーム。`DripStrategy`により処理タイミングを制御可能です。

---

### Stream生成関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`stream`** | `<A>(strategy?: DripStrategy) => DripperStream<A>` | 値を外部から投入できるソースストリームを生成 例: `const click$ = stream();` |
| **`merge`** | `<A>(reducer?: (a: A, b: A) => A) => (streams: Stream<A>[]) => MergedStream<A>` | 複数のStreamを一つに合流。`reducer`で値の結合方法を指定可能 |
| **`proxy`** | `<T, K extends keyof T>(obj: T, key: K) => [DripperStream<T[K]>, Prop<T[K]>]` | 既存オブジェクトのプロパティをリアクティブ化 |

#### DripStrategy

```typescript
type DripStrategy = 
  | { type: 'immediate' }                      // 即座に処理
  | { type: 'throttle', interval: number }     // 指定間隔で間引き
  | { type: 'debounce', delay: number }        // 最後の値のみ遅延処理
```

---

### Stream変換オペレーター

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`map`** | `<A, B>(fn: (b: B) => A \| Prop<A> \| A) => (s: Stream<B>) => MappedStream<A>` | 各値を変換する新しいStreamを生成 |
| **`filter`** | `<A>(predicate: (v: A) => boolean \| RegExp \| A) => (s: Stream<A>) => FilterStream<A>` | 条件を満たす値のみを通過させる |
| **`junction`** | `<A, B>(records: Map<B, Stream<A>>) => (p: Prop<B>) => MergedStream<A>` | Propの値に応じて動的にStreamを切り替え |

---

### Prop生成関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`hold`** | `<A>(initial: A) => (s: Stream<A>) => Prop<A>` | Streamから最新の値を保持するPropを生成 例: `const $text = hold("")(textInput$);` |
| **`accum`** | `<S, A>(reducer: (s: S, v: A) => S, initial: S) => (s: Stream<A>) => Prop<S>` | Streamの値を畳み込んで累積 |
| **`when`** | `<A>(predicate: (v: A) => boolean) => (p: Prop<A>) => PromisedProp<A>` | 条件を満たすまで待機するPromise付きProp |

---

### Prop変換オペレーター

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`lift`** | `<A>(fn: (values: any[]) => A) => (props: Prop<any>[]) => Prop<A>` | 複数のPropを合成して新しいPropを生成 |
| **`remap`** | `<A, B>(fn: (v: B, prev?: B) => A) => (p: Prop<B>) => Prop<A>` | Propの値を変換して新しいPropを生成 |

---

### フロー制御関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`drip`** | `<A>(value: A, options?: DripOptions) => (d: DripperStream<A>) => DripEffect<A>` | Streamに値を流し込みEffectを生成 |
| **`collapse`** | `(effect: DripEffect) => Promise<number>` | `drip`で生成したEffectを実行し、関連するPropを更新 |
| **`registerCollapseObserver`** | `(observer: CollapseObserver, handler: Function) => () => void` | collapse実行時の各フェーズにフック処理を登録 |

#### CollapseObserver

```typescript
type CollapseObserver = 
  | 'immediate'   // 同期的に実行
  | 'visual'      // requestAnimationFrame
  | 'quantum'     // queueMicrotask
  | 'sequential'  // setTimeout
  | 'thrown'      // エラー時
```

---

### ユーティリティ関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`isStream`** | `(v: unknown) => v is Stream<any>` | Streamかどうかを判定 |
| **`isDripper`** | `(v: unknown) => v is DripperStream<any>` | DripperStreamかどうかを判定 |
| **`isChainedProp`** | `(v: unknown) => v is Prop<any>` | データフローに接続されたPropかを判定 |
| **`clear`** | `(s: Stream<any>, recursive?: boolean) => void` | Streamのメモリを解放 |
| **`vertex`** | `(s: Stream<any>) => Vertex` | Streamの依存グラフを生成 |
| **`pipe`** | `<A>(value: A, ...ops: Function[]) => any` | 関数を連鎖的に適用 |

---

### グローバル定数

| 定数 | 型 | 説明 |
|------|---|------|
| **`clock`** | `Prop<number>` | アプリケーション全体の時刻を保持するProp |
| **`NotThen`** | `symbol` | `when`で条件を満たしていない状態を表す |

---

## <a id="blooky-dom"></a>`blooky-dom` - DOM構築

### モジュールの役割

`blooky-dom`は、JavaScriptオブジェクトリテラルからDOMを構築し、Propと自動的にバインディングする宣言的UIライブラリです。仮想DOMを使わず、実DOMを直接操作することで、Web標準に準拠した軽量な実装を実現します。

### 中心となる概念

**`JSHTMLNodeSource` - DOM記述**  
DOMノードを表現するための型。Node、文字列、数値、Promise、Prop、配列、オブジェクトリテラルなど、様々な形式をサポート。

**`prime` - コンポーネントファクトリ **
blookyにおける型安全なコンポーネントを作成するための中心的な関数。**コンテキスト（Props and Drippers）を受け取り、UIの設計図（`JSHTMLNodeSource`）を返す純粋な関数を、最終的なレンダリング関数へと変換します。

**`PropBridge` - リアクティブバインディング**  
PropとDOM要素を接続するブリッジ。Propの値が変更されると、自動的にDOMを更新。

---

### DOM構築関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`jshtml`** | `(source: JSHTMLNodeSource, context?: object) => Node` | オブジェクトリテラルからDOMノードを生成 |
| **`jshtml.$`** | `(attrs: JSHTMLAttributeMapSource) => EmptyElementAttributeMapSource` | 空要素用の属性マップを生成 |
| **`prime`** | `<T>(fn: (ctx: T) => JSHTMLNodeSource) => (ctx: T) => Node` | 型安全なコンポーネントファクトリを生成。 例: `const MyComponent = prime((ctx: MyCtx) => ({ p: ctx.text }));` |
| **`promised`** | `(promise: Promise<JSHTMLNodeSource>, placeholder?: JSHTMLNodeSource) => PromisedElement` | Promise解決後にDOMを生成する要素 |

#### JSHTMLNodeSource型

```typescript
type JSHTMLNodeSource = 
  | Node                      // 既存のDOMノード
  | string | number | boolean // テキストノード
  | null | undefined          // 空ノード
  | Promise<JSHTMLNodeSource> // 非同期ノード
  | Prop<JSHTMLNodeSource>    // リアクティブノード
  | JSHTMLNodeSource[]        // ノードの配列
  | JSHTMLElementSource       // 要素定義オブジェクト

type JSHTMLElementSource = {
  [tagName: string]: JSHTMLNodeSource;  // タグと子要素
  $?: JSHTMLAttributeMapSource;         // 属性マップ
}
```

---

### イベント・監視関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`eventDripper`** | `<E extends Event>(strategy?: DripStrategy & InterceptOptions): Dripper<E> & EventListenerObject` | EventListenerObjectインターフェースを実装したdripperを生成 |
| **`mutations`** | `(init: MutationObserverInit) => (n: Node) => Stream<BlookyMutationEvent>` | DOM変更を監視するStreamを生成 |
| **`listenerForCollapse`** | `<A extends Event>(d: Dripper<A>) => EventListener` | イベントをcollapseに接続するリスナーを生成 |

---

### カスタム要素サポート

| シンボル/関数 | 型 | 説明 |
|------|---|------|
| **`JSHTML_ELEMENT_HANDLER`** | `symbol` | カスタム要素のファクトリメソッド用シンボル |
| **`JSHTML_ATTR_HANDLER`** | `symbol` | カスタム属性ハンドラー用シンボル |
| **`defineAttrUpdateHandlers`** | `(handlers: Record<string, Function>) => void` | グローバル属性ハンドラーを登録 |

---

### 属性ハンドリング

jshtmlは以下の特殊な属性を自動的に処理：

| 属性名 | 型 | 説明 |
|--------|---|------|
| **`class`/`className`** | `string \| string[] \| Record<string, boolean>` | クラス名の設定 |
| **`style`** | `CSSStyleDeclaration \| Record<string, string>` | インラインスタイル |
| **`dataset`** | `Record<string, string>` | data-*属性 |
| **`on*`** | `EventListener \| DripperStream` | イベントリスナー。`DripperStream`を渡すとイベントが自動的に`drip>collapse`される |

---

### カスタムイベント

jshtmlが発行するカスタムイベント：

| イベント名 | 詳細データ | 説明 |
|-----------|-----------|------|
| **`node-prop-update`** | `{ prop, nextValue, prevValue }` | Propバインドノードが更新された |
| **`attr-prop-update`** | `{ prop, name, nextValue, prevValue }` | Propバインド属性が更新された |
| **`blooky-collapse-start`** | `DripEffect` | collapse開始（キャンセル可能） |
| **`blooky-collapse-completed`** | `DripEffect & { resolved }` | collapse完了 |
| **`blooky-collapse-failed`** | `DripEffect & { rejected }` | collapseエラー |

---

## <a id="blooky-fx"></a>`blooky-fx` - 副作用管理

### モジュールの役割

`blooky-fx`は、複雑な非同期処理や副作用を構造化し、テスト可能で追跡可能にする副作用オーケストレーションライブラリです。宣言的な記述により、実行フローを可視化・制御できます。

### 中心となる概念

**`FxNode` - 副作用ノード**  
実行可能な副作用の単位。sequence、parallel、call等の様々なタイプがあり、ツリー構造を形成。

**`FxRef<T>` - コンテキスト参照**  
実行時にコンテキストから解決される値への参照。`ref("key")`で生成。

**`ExecContext` - 実行コンテキスト**  
副作用実行時の環境。キャンセルトークン、ミドルウェア、フック等を含む。

---

### ノードファクトリ（fxオブジェクト）

| 関数 | 引数 | 説明 |
|------|-----|------|
| **`fx.none`** | `()` | 何もしない空ノード |
| **`fx.sequence`** | `(steps: FxNode[])` | 順次実行 |
| **`fx.parallel`** | `(steps: FxNode[])` | 並行実行（全て完了を待つ） |
| **`fx.race`** | `(steps: FxNode[])` | 競合実行（最初の完了を採用） |
| **`fx.wait`** | `({ ms?: FxRef<number>, until?: FxRef<Prop<boolean>> })` | 待機処理 |
| **`fx.call`** | `(fn: FxRef<Function>, options?: CallOptions)` | 関数呼び出し |
| **`fx.condition`** | `(if: FxRef<boolean>, then: FxNode, else?: FxNode)` | 条件分岐 |
| **`fx.switch`** | `(by: FxRef<any>, cases: Map<any, FxNode>, default?: FxNode)` | 多分岐 |
| **`fx.loop`** | `(while: FxRef<boolean>, body: FxNode)` | ループ実行 |
| **`fx.collapse`** | `(value: any, dripper: FxRef<DripperStream>)` | Streamへの値送信 |
| **`fx.yield`** | `({ for: FxRef<string>, value?: any })` | サブフロー実行 |
| **`fx.return`** | `(value?: FxRef<any>)` | サブフローからの返却 |
| **`fx.context`** | `(ctx: object, child: FxNode, id?: string)` | コンテキスト定義 |

#### CallOptions

```typescript
interface CallOptions {
  arg?: FxRef<any>;        // 関数の引数
  context?: FxRef<any>;    // thisコンテキスト
  catcher?: FxRef<Function>; // エラーハンドラ
  id?: string;             // 結果の保存ID
}
```

---

### 実行管理関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`ref`** | `<T>(key: string) => FxRef<T>` | コンテキストキーへの参照を生成 |
| **`isFxRef`** | `(v: unknown) => v is FxRef<any>` | FxRef判定 |
| **`prepare`** | `(node: FxNode, context: AppContext, parent?: ExecContext) => PreparedFx` | 実行準備（コンパイル） |
| **`execute`** | `(prepared: PreparedFx) => ExecutionHandle` | 準備済みフローを実行 |
| **`query`** | `(node: FxNode, app?: AppContext, ctx?: ExecContext) => ExecutionHandle` | prepare→executeのショートハンド |
| **`createCancelToken`** | `(parent?: CancelToken) => CancelToken` | キャンセルトークン生成 |

---

### 実行コンテキスト

```typescript
interface ExecContext {
  resolve: (v: FxRef<any>) => Prop<any>;     // 参照解決
  cancelToken: CancelToken;                   // キャンセル制御
  middlewares?: FxMiddleware[];               // ミドルウェア
  onNodeEnter?: (node: FxNode) => void;      // ノード開始フック
  onNodeExit?: (node: FxNode, reason?: any, error?: any) => void; // ノード終了フック
}
```

---

### ミドルウェア

```typescript
type FxMiddleware = (
  ctx: FxExecutionContext,
  next: () => Promise<any>
) => Promise<any>;
```

ミドルウェアは各ノード実行の前後に処理を挟み込める：

```typescript
const loggingMiddleware: FxMiddleware = async (ctx, next) => {
  console.log('Start:', ctx.node.type);
  const result = await next();
  console.log('End:', ctx.node.type);
  return result;
};
```

---

### 特殊なコンテキストキー

| キー | 説明 |
|-----|------|
| **`$_`** | `yield`で渡された値 |
| **`#<id>`** | IDを持つノードの実行結果 |
| **`RETURN_VALUE`** | `return`ノード用の特殊キー |

---

## <a id="blooky-fxdom"></a>`blooky-fxdom` - 宣言的副作用

### モジュールの役割

`blooky-fxdom`は、副作用フローをHTMLカスタム要素として宣言的に記述できるようにするライブラリです。`blooky-fx`の機能をHTML内で直接使用できます。

### 中心となる概念

**`EffectElement` - 副作用要素基底クラス**  
全てのfx要素の基底となる抽象クラス。`toFxNode()`メソッドでFxNodeに変換。

**コンテキスト継承**  
`fx-context`要素によるコンテキストのスコープ管理と継承。

---

### カスタム要素一覧

| 要素名 | 属性 | 説明 |
|--------|-----|------|
| **`<fx-effect>`** | - | ルート副作用コンテナ |
| **`<fx-sequence>`** | - | 子要素を順次実行 |
| **`<fx-parallel>`** | - | 子要素を並行実行 |
| **`<fx-race>`** | - | 子要素を競合実行 |
| **`<fx-wait>`** | `ms`, `until` | 指定時間または条件まで待機 |
| **`<fx-call>`** | `fn`, `arg`, `catcher` | 関数呼び出し |
| **`<fx-if>`** | `when` | 条件分岐（slot="then"/"else"） |
| **`<fx-switch>`** | `by` | 多分岐（slot属性で分岐先指定） |
| **`<fx-loop>`** | `while` | 条件が真の間ループ |
| **`<fx-collapse>`** | `dripper`, `value` | Streamに値を送信 |
| **`<fx-yield>`** | `for`, `value` | サブフローを実行 |
| **`<fx-return>`** | `value` | サブフローから値を返却 |
| **`<fx-context>`** | `use` | コンテキストスコープ定義 |
| **`<fx-include>`** | `src` | 外部JSONフローを読み込み |

---

### 属性の動的バインディング

fx要素の属性は、コンテキストキーを文字列で指定することで動的にバインド可能：

```html
<!-- コンテキストの api.search 関数を呼び出し -->
<fx-call fn="api.search" arg="$query"></fx-call>

<!-- コンテキストの $isReady Propを参照 -->
<fx-wait until="$isReady"></fx-wait>
```

---

### コンテキスト管理

#### use属性

`fx-context`の`use`属性で、使用可能なコンテキストキーを制限：

```html
<!-- 全てのキーを使用可能 -->
<fx-context use="*">
  
<!-- 特定のキーのみ使用可能 -->
<fx-context use="api,auth,$user">
  
<!-- 親コンテキストを継承しつつ追加 -->
<fx-context>
  <fx-context use="api">
```

---

### 登録関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`fxdom.defineEffectElements`** | `(map?: Record<string, typeof EffectElement>) => void` | fx要素をカスタム要素として登録 |

---

### 統合例

```typescript
// JavaScript側でコンテキストを定義
const context = {
  api: apiClient,
  $isLoading: isLoadingProp,
  handleError: (err) => console.error(err)
};

// HTMLで副作用フローを記述
const effect = jshtml({
  "fx-effect": {
    "fx-sequence": [
      { "fx-wait": jshtml.$({ until: "$isLoading" }) },
      { "fx-call": jshtml.$({ 
        fn: "api.fetch", 
        catcher: "handleError" 
      })}
    ]
  }
}, context);
```

---

## <a id="blooky-devtools"></a>`blooky-devtools` - 開発ツール

### モジュールの役割

`blooky-devtools`は、Blookyアプリケーションの開発体験を向上させるツール群です。データフローの可視化、副作用の実行状態監視、パフォーマンス分析等の機能を提供します。

### 中心となる概念

**グラフ可視化**  
Stream/Propの依存関係をDOT形式で出力し、Graphvizで可視化。

**リアルタイムデバッグ**  
fx要素の実行状態をCSSクラスとカスタムイベントで監視。

---

### 可視化関数

| 関数 | 型シグネチャ | 説明 |
|------|------------|------|
| **`dumpGraphDOT`** | `(entries: Record<string, Stream \| Prop>, attrs?: object) => string` | Stream/Propの依存グラフをDOT形式で出力 |
| **`vertex`** | `(s: Stream<any>) => Vertex` | Streamの依存関係ツリーを生成 |
| **`isVertex`** | `(v: unknown) => v is Vertex` | Vertex型判定 |

#### DOT出力のカスタマイズ

```typescript
const dot = dumpGraphDOT(streams, {
  rankdir: "TB",    // Top-Bottom, LR, RL, BT
  bgcolor: "#f0f0f0",
  fontname: "Arial"
});
```

---

### デバッグ用fx要素

| 定数/関数 | 説明 |
|----------|------|
| **`EffectElementTagNameMap`** | デバッグ機能付きfx要素のマップ |
| **`debugMiddleware`** | エラーハンドリングと状態追跡のミドルウェア |

#### 実行状態のCSSクラス

デバッグ版のfx要素は以下のCSSクラスを自動付与：

| クラス名 | 状態 |
|---------|------|
| **`is-running`** | 実行中 |
| **`is-paused`** | wait中 |
| **`is-failed`** | エラー発生 |
| **`is-completed`** | 正常完了 |
| **`is-recovered`** | エラーから復旧 |

---

### カスタムミドルウェア例

```typescript
// タイミング計測ミドルウェア
const timingMiddleware: FxMiddleware = async (ctx, next) => {
  const start = performance.now();
  try {
    const result = await next();
    console.log(`${ctx.node.type}: ${performance.now() - start}ms`);
    return result;
  } catch (error) {
    console.error(`${ctx.node.type} failed`);
    throw error;
  }
};

// 適用
const prepared = prepare(flow, context, {
  middlewares: [debugMiddleware, timingMiddleware]
});
```

---

### エラー追跡

BlookyErrorのカテゴリと専用Stream：

| カテゴリ | Stream | 説明 |
|---------|--------|------|
| **`dev-config`** | `blooky.errorStream['dev-config']` | 開発設定エラー |
| **`structure`** | `blooky.errorStream['structure']` | 構造エラー |
| **`constraint`** | `blooky.errorStream['constraint']` | 制約違反 |
| **`flow`** | `blooky.errorStream['flow']` | フローエラー |
| **`user`** | `blooky.errorStream['user']` | ユーザーエラー |

```typescript
// エラーを監視
const $errors = hold([])(
  accum((errors, err) => [...errors, err], [])(
    blooky.errorStream['flow']
  )
);
```

---

### 統合デバッグ例

```typescript
import { fxdom, EffectElementTagNameMap, dumpGraphDOT, debugMiddleware } from 'blooky-devtools';
import { instance as vizInstance } from '@viz-js/viz';

// 1. デバッグ版fx要素を登録
fxdom.defineEffectElements(EffectElementTagNameMap);

// 2. データフローを可視化
const dot = dumpGraphDOT({ click$, $count, effect$ });
const viz = await vizInstance();
const svg = viz.renderSVGElement(dot);
document.getElementById('graph').append(svg);

// 3. エフェクトにデバッグミドルウェアを適用
const handle = execute(prepare(flow, context, {
  middlewares: [debugMiddleware]
}));

// 4. 実行状態をCSSで可視化
// fx要素に自動的にis-running等のクラスが付与される
```

---

## 型定義サマリー

### 基本型

```typescript
// Stream系
type Stream<A> = {
  next: Set<Stream<any>>;
  lazyNext: Set<Stream<any>>;
}

type DripperStream<A> = Stream<A> & {
  dripStrategy: DripStrategy;
}

// Prop
type Prop<A> = () => A;

// Effect
type DripEffect<A> = {
  dripper: DripperStream<A>;
  value: A;
  effects: Map<Prop<any>, any>;
}

// FxNode
type FxNode = {
  type: string;
  id?: string;
  catcher?: FxRef<Function>;
  [key: string]: any;
}
```

---

## パフォーマンス考慮事項

### メモリ管理

- `FinalizationRegistry`によるStreamの自動GC
- `WeakMap`によるメタデータ管理
- `clear()`関数による手動クリーンアップ

### 最適化のヒント

1. **大量のProp更新**: `collapse`をバッチ化
2. **頻繁なイベント**: `throttle`/`debounce`戦略を使用
3. **大規模なDOM**: `fx-include`で遅延読み込み
4. **複雑なフロー**: `fx-parallel`で並行化

---

## よくあるパターン

### フォーム送信

```typescript
const submit$ = stream();
const $formData = hold({})(formChange$);

const submitEffect = fx.sequence([
  fx.call(validateForm, { arg: ref("$formData") }),
  fx.condition(
    ref("#valid"),
    fx.call(api.submit, { arg: ref("$formData") }),
    fx.call(showError)
  )
]);
```

### ポーリング

```typescript
const pollEffect = fx.loop(
  ref("$isActive"),
  fx.sequence([
    fx.call(fetchData),
    fx.collapse(ref("#data"), dataStream$),
    fx.wait({ ms: 5000 })
  ])
);
```

### デバウンス検索

```typescript
const search$ = stream({ type: 'debounce', delay: 300 });
const $query = hold("")(search$);

const searchEffect = fx.sequence([
  fx.wait({ until: ref("$query") }),
  fx.call(api.search, { arg: ref("$query") })
]);
```

---

## リファレンス
- [readme](../readme.md) - 簡易的な全体像の紹介
- [チュートリアル](./tutorial.md) - 段階的に学ぶ
- [サンプル集](./examples.md) - 実践的な15のサンプル
- [API Reference](./api.md) - 詳細なAPIドキュメント
- [FAQ](./faq.md) - よくあるご質問

**blooky** — 統合された視座から、Web 開発を再び「理解できるもの」に。
