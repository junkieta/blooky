# Blooky Framework チュートリアル

このチュートリアルでは、Blookyの各モジュールを段階的に学習していきます。最初は単一モジュールから始め、徐々に組み合わせて強力なアプリケーションを構築していきます。

## 📚 目次

1. [Level 1: blooky-fp のみ - リアクティブな値の管理](#level-1)
2. [Level 2: blooky-fp + blooky-dom - リアクティブUI](#level-2)
3. [Level 3: + blooky-fx - 副作用の管理](#level-3)
4. [Level 4: + blooky-fxdom - 宣言的な副作用](#level-4)
5. [Level 5: + blooky-devtools - デバッグと可視化](#level-5)

---

## <a name="level-1"></a>Level 1: blooky-fp のみ - リアクティブな値の管理

最初は`blooky-fp`モジュールだけを使って、リアクティブプログラミングの基礎を学びます。

### 1.1 StreamとPropの基本

```typescript
import { stream, hold, drip, collapse } from 'blooky-fp';

// Streamの作成 - イベントの流れ
const click$ = stream();

// Propの作成 - 現在の値を保持
const $counter = hold(0)(click$);

// 値を確認
console.log($counter()); // 0

// イベントを流す
await collapse(drip(1)(click$));
console.log($counter()); // 1

await collapse(drip(5)(click$));
console.log($counter()); // 5
```

### 1.2 Streamの変換

```typescript
import { stream, map, filter, hold, drip, collapse } from 'blooky-fp';

// 数値のStream
const number$ = stream();

// 偶数だけをフィルタリング
const even$ = filter((n: number) => n % 2 === 0)(number$);

// 値を2倍にする
const doubled$ = map((n: number) => n * 2)(even$);

// 結果を保持
const $result = hold(0)(doubled$);

// テスト
await collapse(drip(3)(number$)); // 奇数は無視される
console.log($result()); // 0

await collapse(drip(4)(number$)); // 偶数は処理される
console.log($result()); // 8
```

### 1.3 複数のStreamを結合

```typescript
import { stream, merge, accum, drip, collapse } from 'blooky-fp';

// 加算と減算のStream
const increment$ = stream();
const decrement$ = stream();

// マージして累積
const counter$ = merge<number>((a, b) => a + b)([
  map(() => 1)(increment$),
  map(() => -1)(decrement$)
]);

const $total = accum((sum, val) => sum + val, 0)(counter$);

// 操作
await collapse(drip(null)(increment$)); // +1
await collapse(drip(null)(increment$)); // +1
await collapse(drip(null)(decrement$)); // -1
console.log($total()); // 1
```

### 1.4 時間ベースの処理

```typescript
import { stream, clock, drip, collapse } from 'blooky-fp';

// throttleストラテジーを使用
const throttled$ = stream({ type: 'throttle', interval: 100 });

// debounceストラテジーを使用
const debounced$ = stream({ type: 'debounce', delay: 300 });

// 現在時刻を取得
console.log('Current time:', clock());

// 連続してイベントを送信
for (let i = 0; i < 5; i++) {
  drip(i)(throttled$); // 100ms間隔で処理される
  drip(i)(debounced$); // 最後の1つだけ300ms後に処理される
}
```

### 💡 学んだこと
- **Stream**: イベントの流れを表現
- **Prop**: 現在の値を保持する関数
- **変換**: map, filter, mergeでStreamを加工
- **フロー制御**: throttle, debounceで処理タイミングを制御

---

## <a name="level-2"></a>Level 2: blooky-fp + blooky-dom - リアクティブUI

次に`blooky-dom`を追加して、リアクティブなUIを構築します。

### 2.1 静的なDOM構築

```typescript
import { jshtml } from 'blooky-dom';

// シンプルな要素
const heading = jshtml({ h1: "Hello Blooky!" });

// 属性付き要素
const link = jshtml({
  a: "Click here",
  $: { href: "https://example.com", target: "_blank" }
});

// ネストした構造
const list = jshtml({
  ul: [
    { li: "Item 1" },
    { li: "Item 2" },
    { li: { strong: "Important" } }
  ]
});

document.body.append(heading, link, list);
```

### 2.2 リアクティブなバインディング

```typescript
import { stream, hold, map, drip, collapse } from 'blooky-fp';
import { jshtml } from 'blooky-dom';

// リアクティブな状態
const input$ = stream();
const $text = hold("")(input$);
const $length = remap((text: string) => text.length)($text);

// UIの定義
const ui = jshtml({
  div: [
    { 
      input: null,
      $: {
        type: "text",
        oninput: (e) => collapse(drip(e.target.value)(input$))
      }
    },
    { p: ["You typed: ", $text] },
    { p: ["Length: ", $length] }
  ]
});

document.body.append(ui);
```

### 2.3 primeパターンでコンポーネント化

```typescript
import { stream, hold, map } from 'blooky-fp';
import { prime } from 'blooky-dom';

// カウンターコンポーネント
interface CounterContext {
  $count: Prop<number>;
  increment$: DripperStream<void>;
  decrement$: DripperStream<void>;
}

const Counter = prime(({ $count, increment$, decrement$ }: CounterContext) => ({
  div: [
    { h2: "Counter Component" },
    { p: ["Current: ", $count] },
    {
      div: [
        { button: "-", $: { onclick: decrement$ } },
        { span: $count, $: { style: { margin: "0 10px" } } },
        { button: "+", $: { onclick: increment$ } }
      ]
    }
  ]
}));

// 使用
const increment$ = stream();
const decrement$ = stream();
const $count = accum((c, v) => c + v, 0)(
  merge<number>()([
    map(() => 1)(increment$),
    map(() => -1)(decrement$)
  ])
);

document.body.append(Counter({ $count, increment$, decrement$ }));
```

### 2.4 条件付きレンダリング

```typescript
import { stream, hold, map } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';

const toggle$ = stream();
const $isVisible = hold(false)(map(() => !$isVisible())(toggle$));

const ConditionalUI = prime(({ $isVisible, toggle$ }) => ({
  div: [
    { button: "Toggle", $: { onclick: toggle$ } },
    remap((visible) => visible
      ? { p: "Now you see me!" }
      : { p: "Hidden content" })($isVisible)
  ]
}));

document.body.append(ConditionalUI({ $isVisible, toggle$ }));
```

### 💡 学んだこと
- **jshtml**: オブジェクトリテラルでDOM構築
- **リアクティブバインディング**: PropをUIに直接埋め込み
- **prime**: コンテキストを受け取るコンポーネントファクトリ
- **イベント処理**: StreamをDOMイベントに接続

---

## <a name="level-3"></a>Level 3: + blooky-fx - 副作用の管理

`blooky-fx`を追加して、非同期処理や副作用を扱います。

### 3.1 基本的な副作用フロー

```typescript
import { fx, execute, prepare } from 'blooky-fx';

// シンプルなシーケンス
const saveFlow = fx.sequence([
  fx.call(() => console.log("Saving...")),
  fx.wait({ ms: 1000 }),
  fx.call(() => console.log("Saved!"))
]);

// 実行
const handle = execute(prepare(saveFlow, {}));
await handle.done;
```

### 3.2 コンテキストとref

```typescript
import { fx, ref, execute, prepare } from 'blooky-fx';

// APIクライアント
const api = {
  fetchUser: async (id: number) => {
    await new Promise(r => setTimeout(r, 500));
    return { id, name: `User ${id}` };
  },
  saveUser: async (user: any) => {
    console.log("Saving:", user);
    return true;
  }
};

// フロー定義
const userFlow = fx.sequence([
  fx.call(ref("api.fetchUser"), { arg: 123, id: "step1" }),
  fx.call(ref("log"), { arg: ref("#step1") }), // 前のステップの結果を参照
  fx.call(ref("api.saveUser"), { arg: ref("#step1") })
]);

// コンテキスト付きで実行
const context = {
  "api.fetchUser": api.fetchUser,
  "api.saveUser": api.saveUser,
  log: console.log
};

const handle = execute(prepare(userFlow, context));
await handle.done;
```

### 3.3 条件分岐とエラーハンドリング

```typescript
import { fx, ref } from 'blooky-fx';
import { stream, hold } from 'blooky-fp';

// 状態
const $isLoggedIn = hold(false)(stream());

// エラーハンドラ
const handleError = (error: Error) => {
  console.error("Error handled:", error.message);
  return "recovered";
};

// 条件付きフロー
const authFlow = fx.condition(
  ref("$isLoggedIn"),
  fx.sequence([
    fx.call(ref("fetchUserData")),
    fx.call(ref("updateUI"))
  ]),
  fx.sequence([
    fx.call(() => { throw new Error("Not authenticated"); }, {
      catcher: handleError
    }),
    fx.call(() => console.log("Please login first"))
  ])
);

const context = {
  $isLoggedIn,
  fetchUserData: async () => ({ name: "John" }),
  updateUI: (data) => console.log("UI updated with:", data)
};

execute(prepare(authFlow, context));
```

### 3.4 並行処理

```typescript
import { fx, execute, prepare } from 'blooky-fx';

// 並行してAPIを呼び出す
const parallelFetch = fx.parallel([
  fx.call(async () => {
    await new Promise(r => setTimeout(r, 1000));
    return "Data A";
  }),
  fx.call(async () => {
    await new Promise(r => setTimeout(r, 800));
    return "Data B";
  }),
  fx.call(async () => {
    await new Promise(r => setTimeout(r, 600));
    return "Data C";
  })
]);

const start = Date.now();
const handle = execute(prepare(parallelFetch, {}));
const results = await handle.done;
console.log(`Completed in ${Date.now() - start}ms`);
console.log("Results:", results); // 約1000ms後に全結果
```

### 💡 学んだこと
- **fx nodes**: sequence, parallel, condition等の制御構造
- **ref**: コンテキストからの値参照
- **prepare/execute**: フローの準備と実行の分離
- **エラーハンドリング**: catcherによる復旧処理

---

## <a name="level-4"></a>Level 4: + blooky-fxdom - 宣言的な副作用

`blooky-fxdom`を追加して、HTMLで副作用を宣言的に記述します。

### 4.1 HTMLでの副作用定義

```typescript
import { fxdom } from 'blooky-fxdom';
import { jshtml, prime } from 'blooky-dom';
import { stream } from 'blooky-fp';

// fx要素を登録
fxdom.defineEffectElements();

// データ取得の副作用をHTMLで定義
const DataFetcher = prime(({ fetch$, $data, $fetchStart, $loading }) => ({
  div: [
    { button: "Fetch Data", $: { onclick: fetch$ } },
    { p: $loading ? "Loading..." : ["Data: ", $data] },
    {
      "fx-effect": {
        "fx-sequence": [
          { "fx-wait": jshtml.$({ until: $fetchStart }) },
          { "fx-call": "setLoading", $: { arg: true } },
          { "fx-call": "fetchData", $: { id: "result" } },
          { "fx-call": "setData", $: { arg: "#result" } },
          { "fx-call": "setLoading", $: { arg: false } }
        ]
      }
    }
  ]
}));
```

### 4.2 フロー制御要素

```html
<!-- 条件分岐 -->
<fx-if when="$isReady">
  <fx-sequence>
    <fx-call fn="initialize" />
    <fx-collapse dripper="status$">System ready</fx-collapse>
  </fx-sequence>
  <fx-parallel slot="else">
    <fx-wait ms="1000" />
    <fx-call fn="checkSystem" />
  </fx-parallel>
</fx-if>

<!-- スイッチ -->
<fx-switch by="$userRole">
  <fx-call slot="admin" fn="loadAdminDashboard" />
  <fx-call slot="user" fn="loadUserDashboard" />
  <fx-call slot="default" fn="loadGuestPage" />
</fx-switch>

<!-- ループ -->
<fx-loop while="$hasMore">
  <fx-sequence>
    <fx-call fn="fetchNextPage" />
    <fx-wait ms="100" />
  </fx-sequence>
</fx-loop>
```

### 4.3 コンテキストの継承

```typescript
import { jshtml, prime } from 'blooky-dom';

const NestedEffects = prime((context) => ({
  "fx-effect": [
    // ルートコンテキスト
    {
      "fx-context": [
        // 子コンテキスト（親を継承）
        {
          "fx-context": {
            "fx-call": jshtml.$({ fn: "api.save" })
          },
          $: { use: "api" } // apiのみ使用を許可
        }
      ],
      $: { use: "*" } // 全て使用可能
    }
  ]
}));
```

### 4.4 yieldとreturn

```typescript
const SubFlow = prime(({ confirmDialog$ }) => ({
  div: [
    {
      "fx-effect": [
        // サブフロー定義
        {
          "fx-context": [
            { "fx-collapse": jshtml.$({ 
              dripper: "confirmDialog$", 
              value: "yieldedValue" 
            }) },
            { "fx-wait": jshtml.$({ until: "$answer" }) },
            { "fx-return": jshtml.$({ value: "$answer" }) }
          ],
          $: { id: "confirmFlow" }
        },
        // メインフロー
        {
          "fx-sequence": [
            { "fx-yield": "Continue?", $: { 
              for: "#confirmFlow", 
              id: "userChoice" 
            }},
            {
              "fx-if": {
                "fx-call": "proceed",
                $: { when: "#userChoice" }
              }
            }
          ]
        }
      ]
    }
  ]
}));
```

### 💡 学んだこと
- **fx要素**: HTMLで副作用フローを宣言
- **コンテキスト**: use属性で依存関係を明示
- **yield/return**: サブフローとの値のやり取り
- **統合**: DOM更新とエフェクトの連携

---

## <a name="level-5"></a>Level 5: + blooky-devtools - デバッグと可視化

最後に`blooky-devtools`を追加して、開発体験を向上させます。

### 5.1 データフローの可視化

```typescript
import { dumpGraphDOT } from 'blooky-devtools';
import { instance as vizInstance } from '@viz-js/viz';

// アプリケーションの全Stream/Propを登録
const appStreams = {
  click$,
  hover$,
  $count,
  $message,
  $isLoading
};

// DOT形式で出力
const dot = dumpGraphDOT(appStreams, { 
  rankdir: "TB",  // Top to Bottom
  bgcolor: "#f0f0f0"
});

// SVGとして描画
const viz = await vizInstance();
const svg = viz.renderSVGElement(dot);
document.getElementById("graph").append(svg);
```

### 5.2 エフェクトのリアルタイムデバッグ

```typescript
import { fxdom, EffectElementTagNameMap } from 'blooky-devtools';

// デバッグ機能付きのfx要素を登録
fxdom.defineEffectElements(EffectElementTagNameMap);

// 実行状態をCSSクラスで可視化
// - is-running: 実行中
// - is-paused: wait中
// - is-failed: エラー発生
// - is-completed: 完了
```

### 5.3 カスタムデバッグミドルウェア

```typescript
import { debugMiddleware } from 'blooky-devtools';
import { prepare, execute } from 'blooky-fx';

// タイミング計測ミドルウェア
const timingMiddleware = async (ctx, next) => {
  const start = performance.now();
  const nodeName = ctx.node.type;
  
  console.group(`⚡ ${nodeName}`);
  try {
    const result = await next();
    console.log(`✅ Completed in ${performance.now() - start}ms`);
    return result;
  } catch (error) {
    console.error(`❌ Failed after ${performance.now() - start}ms`);
    throw error;
  } finally {
    console.groupEnd();
  }
};

// ミドルウェアを適用
const prepared = prepare(flow, context, {
  middlewares: [debugMiddleware, timingMiddleware]
});

execute(prepared);
```

### 5.4 統合デバッグダッシュボード

```typescript
import { stream, accum } from 'blooky-fp';
import { jshtml, prime } from 'blooky-dom';
import { dumpGraphDOT } from 'blooky-devtools';

const DebugDashboard = prime((context) => ({
  div: [
    { h3: "Debug Dashboard" },
    {
      details: [
        { summary: "Active Streams" },
        { pre: dumpGraphDOT(context) }
      ]
    },
    {
      details: [
        { summary: "Effect Status" },
        { div: context.$effectLogs }
      ]
    },
    {
      details: [
        { summary: "Performance" },
        {
          ul: [
            { li: ["FPS: ", context.$fps] },
            { li: ["Active effects: ", context.$activeEffects] },
            { li: ["Memory: ", context.$memory] }
          ]
        }
      ]
    }
  ],
  $: { 
    class: "debug-dashboard",
    style: { 
      position: "fixed",
      top: "10px",
      right: "10px",
      background: "white",
      border: "1px solid #ccc",
      padding: "10px",
      maxWidth: "300px"
    }
  }
}));

// 開発環境でのみ表示
if (process.env.NODE_ENV === 'development') {
  document.body.append(DebugDashboard(debugContext));
}
```

### 💡 学んだこと
- **グラフ可視化**: Stream/Propの依存関係を図示
- **リアルタイムデバッグ**: エフェクトの実行状態を監視
- **ミドルウェア**: 横断的な処理の追加
- **開発ツール統合**: 包括的なデバッグ環境

---

## 🎯 まとめ

各レベルで学んだモジュール：

| Level | モジュール | 学んだこと |
|-------|----------|----------|
| 1 | blooky-fp | Stream/Propによるリアクティブプログラミング |
| 2 | + blooky-dom | リアクティブUIの構築 |
| 3 | + blooky-fx | プログラマティックな副作用管理 |
| 4 | + blooky-fxdom | 宣言的な副作用の記述 |
| 5 | + blooky-devtools | デバッグと開発支援 |

## 🚀 次のステップ

1. **実践プロジェクト**: TODOアプリやダッシュボードを作成
2. **カスタムオペレーター**: 独自のStream変換を実装
3. **パフォーマンス最適化**: 大規模アプリケーションへの対応
4. **テスト戦略**: 各モジュールのユニットテスト作成

## 📚 リファレンス

- [API Documentation](./api.md)
- [Examples](./examples/)
- [Best Practices](./best-practices.md)
- [FAQ](./faq.md)