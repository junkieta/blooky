# blooky.js

`blooky.js`は、**コーディング体験そのものを進化させる**ために生まれた、TypeScriptのための関数型リアクティブプログラミング（FRP）フレームワークです。

単にUIを構築するライブラリではありません。`blooky.js`は、アプリケーションを\*\*空間 (`fp`)、作用 (`fx`)、文脈 (`fc`)、そして時間 (`ft`)\*\*という4つの次元で捉え、それらを宣言的かつ合成可能な形で操作するための、一貫した哲学とツール群を提供します。

これにより、複雑な非同期処理や状態管理は驚くほどシンプルになり、あなたの思考は、 HOW（どのように実装するか）から \*\*WHAT（何がしたいのか）\*\*へと解放されます。

-----

## 哲学と4つの柱

`blooky.js`は、4つのコアモジュール（柱）によって構成されています。これらは互いに連携し、堅牢で、予測可能で、そして書くのが楽しいアプリケーション開発を実現します。

  * ### `fp` (Functional Programming) - 空間を司る

    全ての基本となる、データの流れ（**空間**）を定義するモジュールです。

      * **`Stream`**: 未来に発生するイベントの「可能性の流れ」。全てのリアクティビティの源泉です。
      * **`Prop`**: `Stream`から生成される「確定した状態」。UIに直接バインドできます。

  * ### `fc` (Functional Context) - 文脈を司る

    アプリケーションの状態、依存関係、そしてその「**契約**」を定義する、フレームワークの司令塔です。

      * **設計図 (Blueprint)**: プレーンなオブジェクトから、プロパティの可視性や不変性といったルールを記述した「設計図」を生成します。
      * **TypeScriptユーティリティ型の再現**: `pick`や`omit`といった、慣れ親しんだ語彙で、実行時のコンテキストを安全かつ宣言的に操作できます。

  * ### `fx` (Effects) - 作用を司る

    副作用（**作用**）を管理する、宣言的なオーケストレーションエンジンです。

      * **DOMとしての副作用**: API通信やタイマーといった副作用のフローを、`<fx-wait>`や`<fx-call>`のようなカスタム要素として、DOM上に宣言的に記述します。
      * **`fc`との連携**: `fx`が利用する`Prop`や関数は、全て`fc`によって提供されるコンテキストを通して、安全に注入されます。

  * ### `ft` (Functional Time) - 時間を司る

    アプリケーションの「**時間**」を操作し、状態の歴史を管理する、強力な時間旅行エンジンです。

      * **自動的なスナップショット**: `fc`によって追跡対象とされたコンテキストの状態は、`ft.snapshot()`を呼び出すことで、その瞬間の`Effect`と共にプロトタイプチェーンに記録されます。
      * **ブランチとチェックアウト**: `undo`/`redo`はもちろん、「もしも」の歴史をブランチとして派生させ、`checkout`で自在に時間軸を移動できます。デバッグやテストのあり方を根底から変える可能性を秘めています。

-----

## クイックスタート

以下は、`blooky.js`の要素を使った、シンプルなカウンターアプリケーションの例です。

### `index.html`

```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>Blooky Quick Start</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

### `src/main.ts`

```typescript
import { stream, accum, merge, map } from "./blooky-fp";
import { jshtml, collapse } from "./blooky-dom";
import { fc } from "./blooky-fc";
import { ft } from "./blooky-ft";

// --- 1. アプリケーションの「文脈（Context）」を定義する ---
// fc.blueprint()を使い、プレーンなオブジェクトから「設計図」を作成し、
// fc.build()で最終的なコンテキストを具現化する。

const appContextSpec = fc.blueprint({
  // `fp`で状態とイベントを定義
  increment$: stream<void>(),
  decrement$: stream<void>(),
  
  get $count() {
    // ゲッタープロパティとしてPropを定義
    return accum(
      (c, v) => c + v, 0
    )(merge<number>()([
      map(() => 1)(this.increment$),
      map(() => -1)(this.decrement$)
    ]));
  },
  
  log: (message: string) => console.log(message)
});

const context = fc.build(appContextSpec);


// --- 2. UIを定義する ---
// fc.prime()を使い、コンテキストをUIテンプレートに注入する。

const AppUI = fc.prime(context)(({ $count, increment$, decrement$, log }) => 
  jshtml({
    main: [
      { h1: ["Count: ", $count] },
      // UIイベントをStreamに接続
      { button: "+", $: { onclick: collapse(increment$) } },
      { button: "-", $: { onclick: collapse(decrement$) } },
      // コンテキストの関数を直接呼び出す
      { button: "Log", $: { onclick: () => log(`Count is: ${$count()}`) } }
    ]
  })
);


// --- 3. 時間旅行の準備 ---
// (例) 5秒ごとに自動でスナップショットを記録する
setInterval(() => {
  ft.snapshot(context);
  console.log("Snapshot taken!");
}, 5000);


// --- 4. マウント ---
document.getElementById('app')?.append(AppUI);
```