# `blooky-fp.ts` APIドキュメント

## `blooky-fp`の役割

`blooky-fp.ts`は、`blooky.js`の全てのリアクティビティを支える、最も基本的な\*\*空間 (`space`)\*\*を定義するコアモジュールです。このモジュールはプラットフォームに依存せず、データの「流れ」と「状態」を扱うための、純粋で合成可能なプリミティブとオペレーターを提供します。

## 中心となる概念

  * **`Stream` - イベントの流れ**:
    未来に発生する一連のイベントを表現するデータ構造です。`Stream`自体は値を持たず、「これから値が流れてくる可能性がある」という**可能性**や**設計図**を定義します。`map`や`filter`といったオペレーターを繋げることで、イベントの流れを合成・変換していくための基本単位となります。

  * **`Prop` - 確定した状態**:
    `() => A`という形式の、現在の値を返す関数です。`Stream`から`hold`や`accum`といった関数を通じて生成され、ある時点での**確定した状態**を表現します。UIへの値のバインディングなど、リアクティブシステムから値を取り出すための主要な出口（Exit Point）です。

この2つを明確に分離することで、「イベント」と「状態」を区別し、予測可能でクリーンなデータフローを構築することが、このライブラリの基本思想です。

-----

## APIリファレンス

### プリミティブ生成関数

| 関数 | 説明 |
| :--- | :--- |
| **`stream<A>()`** | 値を外部から投入できる、全ての`Stream`の起点となる`DripperStream<A>`を生成します。 |
| **`hold<A>(initialValue)(s: Stream<A>)`** | `Stream<A>`を受け取り、その`Stream`から流れてきた最新の値を保持する`Prop<A>`を生成します。 |
| **`accum<S, A>(reducer, seed)(s: Stream<A>)`** | `Stream<A>`から流れてくる値を`reducer`関数で畳み込み、その結果を保持する`Prop<S>`を生成します。 |

-----

### Streamオペレーター

`Stream`を受け取り、新しい`Stream`を返す純粋な関数です。

| 関数 | 説明 |
| :--- | :--- |
| **`map<A, B>(fn)(s: Stream<B>)`** | `Stream<B>`の各値を`fn`で変換し、新しい`Stream<A>`を返します。 |
| **`filter<A>(predicate)(s: Stream<A>)`** | `Stream<A>`から、`predicate`を満たす値だけを通過させる新しい`Stream<A>`を返します。 |
| **`merge<A>(streams: Stream<A>[])`** | 複数の`Stream`を一つに合流させた、新しい`Stream<A>`を返します。 |
| **`junction<A, B>(records)(p: Prop<B>)`** | `Prop<B>`の現在の値に応じて、どの`Stream<A>`を有効にするかを動的に切り替える、高度な`Stream`を生成します。 |

-----

### Propオペレーター

`Prop`を受け取り、新しい`Prop`を返す純粋な関数です。

| 関数 | 説明 |
| :--- | :--- |
| **`remap<A, B>(fn)(p: Prop<B>)`** | `Prop<B>`から、その現在の値に`fn`を適用して変換する、新しい派生`Prop<A>`を生成します。 |
| **`lift<A>(fn)(props: Prop<any>[])`** | 複数の`Prop`を元に、それらの現在の値すべてに`fn`を適用して単一の値を計算する、新しい派生`Prop<A>`を生成します。 |

-----

### 高度なプリミティブと出口（Exit Points）

`blooky.js`の世界と、外部のJavaScriptの世界を繋ぐための、より高度な関数です。

| 関数 | 説明 |
| :--- | :--- |
| **`proxy<T, K>(obj, key)`** | 既存のオブジェクトのプロパティを、`blooky.js`が扱える`[DripperStream, Prop]`のペアに変換します。これにより、Reactの`useState`のような、命令的なオブジェクトの状態をリアクティブなデータフローに統合できます。 |
| **`when<A>(predicate)(p: Prop<A>)`** | `Prop<A>`を監視し、その値が`predicate`を満たすと値が更新される（`PromisedProp`）を返します。その他のPropと違い、次にpredicateが満たされた時に解決される`Promise<A>`を返すためのメソッド、`then`を持っています。特定の**未来の状態**を待つための高レベルな出口です。 |

**使用例:**

```typescript
const $progress = hold(0)(...);

// `when`を使って、プログレスバーが100%になったら通知する
when(p => p >= 100)($progress).then(() => {
  console.log("Loading complete!");
});
```

-----

### 副作用のトリガー

| 関数 | 説明 |
| :--- | :--- |
| **`drip<A>(value)(s: DripperStream<A>)`** | **`blooky-fp`における、状態変更を要求する唯一の正規の入り口**です。指定された`Stream`に値を流した場合に、どの`Prop`がどのように更新されるべきか、という\*\*「実行計画書（`DripEffect`オブジェクト）」**を生成します。この関数は副作用を**実行しません\*\*。実際の実行は、`calendar`スケジューラが担当します。 |

-----

### 時間ベースのAPI

| API | 説明 |
| :--- | :--- |
| **`clock`** | `requestAnimationFrame`に同期して現在のタイムスタンプを保持する、公開された`Prop<number>`。 |
| **`moments`** | `clock`を元に、便利な時間ベースの`Stream`を生成するためのファクトリオブジェクトです。（`.timeout(ms)`, `.interval(ms)`） |

-----

### ユーティリティ関数

`blooky.js`の内部構造を安全に操作・判別するためのヘルパー関数です。

| 関数 | 説明 |
| :--- | :--- |
| **`isStream(v)`** | 値が`Stream`であるか（`true`/`false`）を返します。 |
| **`isDripperStream(v)`** | 値が`DripperStream`であるかを返します。 |
| **`isChainedProp(v)`** | 値が`Stream`に接続された`Prop`であるかを返します。`fc`モジュールでの`Prop`の自動検出などに使われます。 |
| **`hasReferences(s)`** | 指定された`Stream`が、`Prop`や他の`Stream`から参照されているかを返します。デバッグやライフサイクル管理に役立ちます。 |
| **`countReferences(s)`** | 指定された`Stream`の参照数を返す`Prop<number>`を生成します。 |

-----

# `blooky-dom.ts` APIドキュメント

## `blooky-dom`の役割

`blooky-dom.ts`は、`blooky-fp`が定義するリアクティブな**状態 (`Prop`)と、ブラウザのDOM**とを結びつけるための、宣言的なUI構築ライブラリです。

`blooky-dom`は、UIをJavaScriptのオブジェクトリテラルで記述する独自の記法 **`jshtml`** を提供します。これにより、HTMLを文字列として組み立てる手間から解放され、`Prop`や`Stream`といったリアクティブな値を、UIの構造の中に直接、安全に埋め込むことができます。

## 中心となる概念

  * **`jshtml` - JavaScriptによる宣言的なDOM構築**:
    HTMLのタグ構造を、ネストしたJavaScriptオブジェクトとして表現します。`{ h1: "Hello" }` と書けば `<h1>Hello</h1>` が生成される、非常に直感的な記法です。

  * **リアクティブなバインディング**:
    `jshtml`の最大の特長は、`fp`が生成した`Prop`を、テキストや属性の値として直接埋め込めることです。`Prop`の値が更新されると、DOMの対応する部分だけが自動的に、かつ効率的に更新されます。

  * **`fc`との連携による、クリーンな依存関係**:
    `blooky-fc`が提供する`prime`（または`view`）関数と組み合わせることで、UIが必要とする状態（`Prop`）やイベントハンドラ（`Stream`）を、クリーンな形でテンプレートに注入できます。これにより、UIコンポーネントの再利用性とテスト容易性が飛躍的に向上します。

-----

### UI構築関数

| 関数 | 説明 |
| :--- | :--- |
| **`jshtml(source)`** | `Prop`や`Stream`を含む、JavaScriptオブジェクトを受け取り、対応するDOMノード (`Node`) を生成します。`blooky-dom`における最も中心的な関数です。 |

**`jshtml`の記法:**

```typescript
import { jshtml } from "./blooky-dom";
import { hold } from "./blooky-fp";

const $name = hold("Blooky");

const myUI = jshtml({
  // タグ名: 子要素
  div: [
    // 子要素は配列で複数指定できる
    { h1: ["Hello, ", $name] }, // Propをテキストとして直接埋め込み
    { p: "This is a blooky app." },
    {
      // 属性は `$` キーにオブジェクトで指定
      button: "Click Me!",
      $: {
        id: "my-button",
        // classは `classList` で、配列やオブジェクトで指定可能
        classList: ["btn", "btn-primary"],
        // styleもオブジェクトで指定
        style: {
          backgroundColor: "blue",
          color: "white"
        }
      }
    }
  ]
});
```

### イベント接続ヘルパー

| 関数 | 説明 |
| :--- | :--- |
| **`collapse(d: DripperStream<A>)`** | DOMイベント（`onclick`など）と`DripperStream`を接続するための「接着剤」。`collapse`が返す関数をイベントハンドラとして渡すだけで、イベント発生時に自動的に`Stream`へ`drip`されます。 |

**使用例 (`fc`との連携):**

```typescript
import { fc } from "./blooky-fc";
import { jshtml, collapse } from "./blooky-dom";
import { stream, accum } from "./blooky-fp";

// 1. fcでコンテキストを定義
const context = fc.build(fc.blueprint({
  increment$: stream<MouseEvent>(),
  get $count() { return accum(c => c + 1, 0)(this.increment$); }
}));

// 2. fc.primeでコンテキストを注入し、UIを定義
const AppUI = fc.prime(context)(({ $count, increment$ }) => 
  jshtml({
    main: [
      { h1: ["Count: ", $count] },
      // クリックイベントをincrement$に接続
      { button: "+", $: { onclick: increment$ } }
    ]
  })
);
```

この例では、`+`ボタンがクリックされるたびに`increment$` `Stream`に`MouseEvent`が`drip`され、その結果`$count` `Prop`が更新され、`<h1>`の表示が自動的に変わります。

-----

# `blooky-fx` & `blooky-fxdom` APIドキュメント

## `blooky-fx`の役割

`blooky-fx`は、アプリケーションにおける副作用（API通信、タイマー、DOM以外の状態変更など）という、予測困難で複雑な「**作用 (`action`)**」を、**宣言的**かつ**安全**に管理するためのオーケストレーション・エンジンです。

`blooky-fx`は、2つのモジュールから構成されます。

  * **`blooky-fx`**:
    副作用のフローを`FxNode`という純粋なJavaScriptオブジェクトのツリーとして表現し、それを解釈・実行する、プラットフォームに依存しないコアエンジン。
  * **`blooky-fxdom`**:
    `FxNode`ツリーを、`<fx-sequence>`や`<fx-call>`といったカスタム要素のツリーとして、**DOM上に直接記述**できるようにするための、`blooky-dom`用アダプター。

通常、開発者は`blooky-fxdom`を主に利用します。

## 中心となる概念

  * **`<fx-effect>` - 副作用のコンテナ**:
    全ての副作用フローの起点となるカスタム要素です。この要素の中に、実行したい副作用のフローを宣言的に記述します。`blooky-fc`によって生成された**コンテキスト**と連携し、フローの実行に必要な`Prop`や関数を受け取ります。

  * **`<fx-*>要素群` - 副作用のビルディングブロック**:
    `if`や`loop`、`call`といった、副作用の具体的な手順を記述するためのカスタム要素群です。これらをHTMLのように組み合わせることで、複雑な非同期処理のロジックを、コードとしてではなく、**宣言的な構造**として表現できます。

-----

## APIリファレンス (`blooky-fxdom`)

`blooky-fxdom`は、`jshtml`を使って副作用フローを構築するための一連のカスタム要素を提供します。

### 基本的なフロー制御要素

| 要素 | 説明 | 属性 |
| :--- | :--- | :--- |
| **`<fx-sequence>`** | 子要素を上から下に、**順番に**実行します。 | - |
| **`<fx-parallel>`** | 子要素を**同時に**実行し、**全て**の完了を待ちます。 | - |
| **`<fx-race>`** | 子要素を**同時に**実行し、**一つでも**完了したら、残りはキャンセルされます。 | - |

### アクション要素

| 要素 | 説明 | 属性 |
| :--- | :--- | :--- |
| **`<fx-call>`** | コンテキストから提供された関数を呼び出します。 | `fn`: (必須) 呼び出す関数の名前。\<br\>`arg`: (任意) 関数に渡す引数。 |
| **`<fx-wait>`** | 処理を一定時間、または特定の条件が満たされるまで待機します。 | `ms`: (任意) 待機する時間（ミリ秒）。\<br\>`until`: (任意) `true`を返すまで待機する`Prop`。 |
| **`<fx-collapse>`** | `fp`の世界に働きかけ、`DripperStream`に値を`drip`します。 | `dripper`: (必須) `drip`対象の`DripperStream`。\<br\>`value`: (任意) `drip`する値。省略した場合、要素のテキストコンテントが使われます。 |

### 条件分岐・ループ要素

| 要素 | 説明 | 属性 |
| :--- | :--- | :--- |
| **`<fx-if>`** | 条件に基づいて、実行するフローを分岐させます。 | `when`: (必須) `true`/`false`を返す`Prop`。 |
| **`<fx-switch>`** | 値に基づいて、実行するフローを多岐に分岐させます。 | `by`: (必須) 分岐の基準となる値を持つ`Prop`。 |
| **`<fx-loop>`** | 条件が満たされている間、子要素のフローを繰り返し実行します。 | `while`: (必須) `true`の間ループを続ける`Prop`。 |

### フローの合成と再利用

これらの要素は、副作用フローをコンポーネントのように分割し、再利用するための、より高度な機能を提供します。

| 要素 | 説明 | 属性 |
| :--- | :--- | :--- |
| **`<fx-include>`** | 外部のJSONファイルに定義された`jshtml`テンプレートを読み込み、その場に展開します。副作用フローの部品化と再利用を促進します。 | `src`: (必須) 読み込むJSONファイルのパス。 |
| **`<fx-yield>`** | 実行を一時停止し、別の副作用フローに処理を**委譲**します。`yield`は値（`value`）を渡し、委譲先が完了して`return`した値を受け取ることができます。Sagaパターンにおける`yield`のように機能します。 | `for`: (必須) 処理を委譲する先のフロー（`<fx-context>`要素など）を指すコンテキストキー。\<br\>`value`: (任意) 委譲先に渡す値。 |
| **`<fx-return>`** | `<fx-include>`,`<fx-yield>`によって開始されたフローから、呼び出し元に値を**返す**ために使います。この要素が実行されると、フローは完了し、`yield`した側がその値を受け取ります。 | `value`: (任意) 呼び出し元に返す値。 |

**使用例 (`yield`/`return`):**

```typescript
// 1. fcで、確認ダイアログのロジックを持つ、再利用可能なフローを定義
const context = fc.build(fc.blueprint({
  // 確認ダイアログのロジック本体
  confirmDialogFlow: fc.build(fc.blueprint({
    // yieldされた値(質問文)を受け取る
    showConfirm: (question: string) => window.confirm(question),
    get flow() {
      return jshtml({
        "fx-sequence": [
          // 1. 委譲元から渡された質問文で、showConfirmを呼び出す
          { "fx-call": { $: { 
              id: "confirmResult", // 結果を#confirmResultとして保存
              fn: this.showConfirm, 
              arg: ref("yieldedValue") // yieldされた値はyieldedValueで受け取る
          }}},
          // 2. 結果を呼び出し元に返す
          { "fx-return": { $: { value: ref("#confirmResult") } } }
        ]
      });
    }
  })),
  
  // メインのフローで使うStream
  save$: stream<void>(),
}));

// 2. メインのフローを記述
const FxFlow = fc.prime(context)(c => 
  jshtml({
    "fx-effect": {
      "fx-loop": {
        $: { while: () => true },
        "fx-sequence": [
          { "fx-wait": { $: { until: c.save$ } } },
          // 1. `confirmDialogFlow`に処理を委譲（yield）
          { "fx-yield": {
            $: {
              id: "isConfirmed", // returnされた値が#isConfirmedに保存される
              for: "confirmDialogFlow",
              value: "本当に保存しますか？"
            }
          }},
          // 2. 戻り値を使って、処理を分岐
          { "fx-if": {
            $: { when: ref("#isConfirmed") },
            "fx-call": { $: { fn: () => console.log("Saved!") } }
          }}
        ]
      }
    }
  })
);
```

-----

# `blooky-fc.ts` APIドキュメント

## `blooky-fc`の役割

`blooky-fc.ts` (Functional Context) は、アプリケーションの状態、依存関係、そして振る舞いの「**契約 (Contract)**」を定義し、管理するための、フレームワークの司令塔です。

`blooky.js`におけるコンテキストは、単なる`Prop`や関数を詰め込んだオブジェクトではありません。`fc`が提供するツール群を使うことで、コンテキストは、その**構造、可視性、不変性、そして正当性**までを保証された、堅牢なコンポーネントとなります。

`fc`の哲学は、「**TypeScriptのユーティリティ型のような、宣言的で合成可能なオペレーターを使って、コンテキストの『設計図』を構築する**」という思想に基づいています。

## 中心となる概念

  * **設計図 (Blueprint)**:
    コンテキストの構造を定義する、`PropertyDescriptorMap`のことです。`fc`が提供するオペレーターは、この不変な「設計図」を操作対象とします。

  * **列挙可能性 (Enumerability)**:
    `getContextProps`（`ft`や`devtools`が使用）が`Prop`を発見するための、唯一のルールです。プロパティが**列挙可能 (`enumerable: true`)** であれば、それはコンテキストの「公開された」インターフェースの一部と見なされます。`fc`の主な役割は、この「列挙可能性」を開発者が自在に制御するための道具を提供することです。

  * **契約による設計 (Design by Contract)**:
    コンテキストが満たすべき仕様（必須キー、値の型など）を「契約」として定義できます。`fc.build`時にこの契約が検証されることで、実行時の堅牢性が保証されます。

## APIリファレンス

### 1\. 設計図の生成 (Blueprint Creation)

| 関数 | 説明 |
| :--- | :--- |
| **`blueprint(obj)`** | プレーンなJavaScriptオブジェクト（とそのプロトタイプチェーン）から、`fc`が操作できる「設計図」を生成します。これが、`fc`のワークフローの最も一般的な開始点です。 |
| **`prop(value, options?)`** | `writable`や`configurable`を細かく制御したい場合に、単一のプロパティディスクリプタを生成します。デフォルトでは`writable: false`, `configurable: false`です。 |

### 2\. 設計図の操作 (Blueprint Operators)

これらのオペレーターは、設計図を受け取り、**新しい設計図**を返します。`pipe`ユーティリティと組み合わせることで、宣言的に設計図を加工できます。

| 関数 | 説明 |
| :--- | :--- |
| **`pick(keys)(blueprint)`** | `Pick<T, K>`の実行時版。設計図から指定されたキーだけを抽出します。 |
| **`omit(keys)(blueprint)`** | `Omit<T, K>`の実行時版。設計図から指定されたキーを**完全に削除**します。 |
| **`unenumerable(keys)(blueprint)`** | 設計図内の指定されたキーを**列挙不可** (`enumerable: false`) にします。`getContextProps`から`Prop`を隠蔽したい場合に使います。 |
| **`merge(...blueprints)`** | 複数の設計図を一つに合成します。 |

### 3\. 設計図の具現化 (Finalizer)

| 関数 | 説明 |
| :--- | :--- |
| **`build(spec, options?)`** | 完成した設計図（`spec`）から、最終的なコンテキストオブジェクトを生成します。`parent`（プロトタイプ継承）、`proxy`（Proxyによる保護）、`contract`（仕様検証）といった高度なオプションを指定できます。 |

### 4\. コンテキストの適用 (Applicators)

| 関数 | 説明 |
| :--- | :--- |
| **`prime(context)(fn)`** | コンテキストを関数の**第一引数**に注入し、実行します。UIテンプレートのレンダリングなどに使います。 |
| **`embody(context)(fn)`** | コンテキストを関数の\*\*`this`\*\*に束縛した、新しい関数を返します。 |

### 5\. 仕様の検証 (Validators)

| オブジェクト | 説明 |
| :--- | :--- |
| **`is`** | `build`の`contract`オプションで使う、型検証器の名前空間です。（`is.string`, `is.prop`など） |

**総合的な使用例:**

```typescript
import { pipe } from "./blooky-fp";
import { fc, is } from "./blooky-fc";

// 1. ベースとなるオブジェクトを定義
const UserProfile = {
  id: 123,
  username: "blooky-user",
  _internalFlag: true
};

// 2. fc.blueprintで「設計図」に変換し、pipeで加工する
const PublicProfileSpec = pipe(
  fc.blueprint(UserProfile),
  fc.omit(["_internalFlag"]),
  fc.readonly
);

// 3. このコンテキストが満たすべき「契約」を定義
const PublicProfileContract = {
  id: is.number,
  username: is.string
};

// 4. 設計図と契約から、最終的なコンテキストを「具現化」
const publicProfile = fc.build(PublicProfileSpec, {
  contract: PublicProfileContract
});

// 5. primeを使って、UIテンプレートに注入
const AppUI = fc.prime(publicProfile)(({ id, username }) => 
  jshtml({
    div: `User: ${username} (ID: ${id})`
  })
);
```

-----

# `blooky-ft.ts` APIドキュメント

## `blooky-ft`の役割

`blooky-ft.ts` (Functional Time) は、アプリケーションの歴史を記録し、自在に時間軸を移動することを可能にする、`blooky.js`の\*\*時間 (`time`)\*\*を司るモジュールです。

`ft`は、Gitの思想にインスパイアされています。`fc`によって定義されたコンテキストの状態を、**スナップショット**として記録し、**ブランチ**として「もしも」の歴史を派生させ、**チェックアウト**で過去の任意の時点へと状態を復元します。

これにより、単なるUndo/Redoを超えた、アプリケーションのデバッグ、テスト、さらにはユーザー体験そのものを根底から変える、強力な機能を提供します。

## 中心となる概念

  * **スナップショット (Snapshot)**:
    `ft.snapshot()`が呼び出された次の`tick`における、追跡対象`Prop`の状態変化（`PropEffect`）を記録した、不変のオブジェクトです。スナップショットは、親となるスナップショットをプロトタイプとして継承することで、差分だけを効率的に記録します。

  * **ブランチ (Branch)**:
    特定のスナップショットを指し示す、名前付きのポインターです。`"main"`ブランチから`"feature-A"`ブランチを派生させる、といった形で、並行した歴史の流れを作ることができます。

  * **HEAD**:
    各コンテキストが、現在どのブランチの先端にいるかを示すポインターです。`checkout`によって、HEADは別のブランチに移動します。

  * **コンテキストごとの歴史**:
    `ft`が管理する全ての歴史（スナップショット、ブランチ、HEAD）は、**コンテキストオブジェクトごとに**独立して管理されます。これにより、アプリケーション内の複数のコンポーネントが、それぞれ独自のタイムラインを持つことができます。

-----

## APIリファレンス

### 時間操作関数

| 関数 | 説明 |
| :--- | :--- |
| **`snapshot(ctx)`** | 指定されたコンテキストの現在の状態を、新しいスナップショットとして記録します。次の`tick`で状態が確定した後にスナップショットが生成され、そのスナップショットを解決する`Promise`を返します。 |
| **`branch(ctx, branchName)`** | 現在のHEADの位置から、指定された名前で新しいブランチを派生させます。 |
| **`checkout(ctx, target)`** | アプリケーションの状態を、指定されたブランチ名またはスナップショットIDの時点に復元します。この操作は副作用を伴い、`fp`のスケジューラ経由で実行されます。 |

**総合的な使用例:**

```typescript
import { fc, is } from "./blooky-fc";
import { ft } from "./blooky-ft";
import { stream, hold, calendar, DripEffect } from "./blooky-fp";
import { jshtml, collapse } from "./blooky-dom";

// 1. fcでコンテキストを定義
const context = fc.build(fc.blueprint({
  message$: stream<string>(),
  get $message() { return hold("Initial", this.message$); }
}));

// 2. UIを定義
const AppUI = fc.prime(context)(({ $message, message$ }) =>
  jshtml({
    main: [
      { h1: ["Message: ", $message] },
      { input: { $: {
          type: "text",
          // 入力イベントでmessage$にdripし、状態を更新
          oninput: (e) => collapse(message$)(e.target.value)
      }}},
      { div: [
          // ftの操作を行うボタン
          { button: "Snapshot", $: { onclick: () => ft.snapshot(context).then(s => console.log("Snapshot created:", s.id)) }},
          { button: "Create Branch 'test'", $: { onclick: () => ft.branch(context, "test") }},
          { button: "Checkout 'main'", $: { onclick: () => ft.checkout(context, "main") }},
          { button: "Checkout 'test'", $: { onclick: () => ft.checkout(context, "test") }},
      ]}
    ]
  })
);

// 4. マウント
document.body.append(AppUI);
```

この例では、ユーザーがテキストボックスに入力して状態を変更するたびに、「Snapshot」ボタンでその歴史を記録できます。「Create Branch」で別の時間軸を作り、「Checkout」でそれぞれの時間軸を自由に行き来することができます。

-----

# `blooky-devtools.ts` APIドキュメント

## `blooky-devtools`の役割

`blooky-devtools.ts`は、`blooky.js`での開発を強力にサポートするための、**オプションのデバッグツール群**です。

このモジュールを導入することで、`fp`のリアクティブなデータフローや、`fx`の複雑な副作用の実行フローを、**視覚的**に把握し、デバッグすることが可能になります。`blooky-devtools`は、あなたのアプリケーション開発を、より楽しく、より効率的なものにします。

## 主な機能

### 1\. 副作用フローのリアルタイム可視化

`blooky-devtools`は、`blooky-fxdom`が提供する全てのカスタム要素（`<fx-sequence>`, `<fx-call>`など）を自動的にラップし、通常は非表示とされている`fx-*`要素を可視化した上で、副作用の実行状態に応じてリアルタイムに見た目を変化させます。

  * **実行中 (`is-running`)**: 青い枠線でハイライトされます。
  * **一時停止中 (`is-paused`)**: `<fx-wait>`などで待機している状態です。
  * **完了 (`is-completed`)**: 正常に実行が完了しました。
  * **キャンセル (`is-canceled`)**: `race`などでキャンセルされました。
  * **エラー (`is-failed`)**: 実行中にエラーが発生しました。

これにより、複雑な`fx`フローが今、どの部分を実行しているのか、どこで待機しているのかが一目瞭然になります。

### 2\. データフローグラフのダンプ

`fp`で構築された`Stream`と`Prop`の複雑な関係性を、Graphviz（DOT言語）形式の文字列として出力する機能を提供します。

  * **`dumpGraphDOT(entries)`**:
    `{ [名前]: StreamまたはProp }` という形式のオブジェクトを受け取り、それらの関係性を表現するDOT文字列を返します。この文字列を可視化ツール（`@viz-js/viz`など）に渡すことで、アプリケーションのデータフロー全体の「地図」をSVGとして描画できます。

## 使い方

### 1\. デバッグ用カスタム要素の登録

アプリケーションのエントリーポイント（`main.ts`など）で、通常の`fxdom`の代わりに、`blooky-devtools`から`fxdom`と`EffectElementTagNameMap`をインポートして、カスタム要素を登録します。

```typescript
// main.ts
// 通常のfxdomからではなく、devtoolsからインポートする
import { fxdom, EffectElementTagNameMap } from "./blooky-devtools";

// これだけで、全てのfx-*要素がデバッグ機能付きになる
fxdom.defineEffectElements(EffectElementTagNameMap);
```

### 2\. データフローの可視化

`dumpGraphDOT`を使って、`fp`の状態を可視化します。

```typescript
import { stream, hold } from "./blooky-fp";
import { dumpGraphDOT } from "./blooky-devtools";
import { instance as viz_instance } from "@viz-js/viz"; // 可視化ライブラリ

// 1. 可視化したいStreamとPropをオブジェクトにまとめる
const streamsAndProps = {
  increment$: stream<void>(),
  $count: hold(0)(/* ... */),
};

// 2. DOT文字列を生成
const dot = dumpGraphDOT(streamsAndProps);

// 3. SVGにレンダリングしてDOMに追加
viz_instance().then(viz => {
  const svgElement = viz.renderSVGElement(dot);
  document.body.append(svgElement);
});
```

### 3\. テーマのカスタマイズ

デバッグ表示の見た目は、CSS変数を使って自由にカスタマイズできます。`<fx-effect>`要素に`theme`属性でCSSファイルへのパスを指定することで、独自のテーマを適用できます。

```html
<fx-effect theme="/path/to/my-theme.css">
  ...
</fx-effect>
```

