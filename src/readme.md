blooky.js

blooky.js は、宣言的かつ高い合成可能性を持つ、TypeScriptのための関数型リアクティブプログラミング（FRP）ライブラリです。

純粋なデータフロー管理（Stream / Prop）と、Sagaパターンに触発された強力な副作用管理エンジン（blooky-effect）を組み合わせることで、複雑な非同期処理を含むアプリケーションを、シンプルで、見通しが良く、そして堅牢に構築することができます。

哲学と特徴

blookyは、いくつかの重要な設計思想に基づいています。

    宣言的: 「どのように（How）」ではなく「何が（What）」を記述することに集中します。UIや副作用のフローを、静的なデータ構造として宣言的に定義します。

    合成可能性: 小さく純粋な関数（オペレータ）を自由に組み合わせることで、複雑なデータフローやロジックを構築します。

    状態と作用の分離: Stream/Propが扱う「状態」と、blooky-effectが管理する「作用（副作用）」を明確に分離し、予測可能性の高いクリーンなアーキテクチャを保ちます。

    強力な副作用管理: async/awaitとジェネレータをベースにした実行エンジンにより、キャンセル処理、エラーからの回復、競合状態の制御といった、複雑な副作用の管理をエレガントに実現します。

    優れた開発体験: オプションのデバッグモジュールにより、副作用の実行フローをリアルタイムに視覚化し、開発を強力にサポートします。

インストール

Bash

npm install blooky

クイックスタート

以下は、blookyの全ての要素（状態管理、UI構築、副作用）を使った、シンプルなカウンターアプリケーションの例です。

index.html

HTML

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

src/main.ts

TypeScript

import { stream, accum, merge, hold, map, remap } from "./blooky";
import { into, jshtml, mount } from "./blooky-dom";
import type { FxEffect } from "./blooky-fxdom";

// 開発中はデバッガーをインポート
import { fxdom, EffectElementTagNameMap } from "./blooky-fxdom-debugger";

// --- 0. 要素の登録 ---
// デバッグ機能付きのfx-*要素を登録する
fxdom.defineEffectElements(EffectElementTagNameMap);


// --- 1. 状態の定義 ---
const increment$ = stream<void>();
const decrement$ = stream<void>();
const save$ = stream<void>();

// `count`というProp（状態）を定義
const count = accum(
  merge<number>()([map(() => 1)(increment$), map(() => -1)(decrement$)])
)((current, val) => current + val, 0);

// `statusMessage`というProp（状態）を定義
const statusMessage = hold('Ready.')(stream<string>());


// --- 2. UIの定義 ---
const AppUI = jshtml({
  main: [
    { h1: ["Count: ", count] }, // Propを直接UIにバインド
    { button: "+", $: { onclick: into(increment$) } }, // UIイベントをStreamに接続
    { button: "-", $: { onclick: into(decrement$) } },
    { button: "Save", $: { onclick: into(save$) } },
    { p: statusMessage, $: { style: { background: '#eee', padding: '1em' } } }
  ]
});


// --- 3. 副作用の定義 ---
const FxFlow = jshtml({
  // `debug-mode`属性で実行フローを可視化
  "fx-effect": [
    { "fx-loop": [
        // save$ Streamからイベントが来るのを待つ
        { "fx-listen": null, $: { "stream-key": "saveTrigger" } },

        // 以降は、保存処理のワークフロー
        { "fx-emit": null, $: { "stream-key": "statusStream", value: '"Saving..."' } },
        { "fx-wait": null, $: { ms: "1000" } },
        { "fx-emit": null, $: { "stream-key": "statusStream", value: "finalMessage" } },
      ],
      // このループは常にtrueなので、無限にsave$を待ち受ける
      $: { while: "alwaysTrue" }
    }
  ],
  $: {
    id: "fx-root",
    "debug-mode": "", // デバッグモードを有効化
    // このフローが使用する値をコンテキスト経由で注入
    use: "saveTrigger, statusStream, finalMessage, alwaysTrue"
  }
}) as FxEffect;


// --- 4. マウントとコンテキスト設定 ---
mount('#app', AppUI);
document.body.append(FxFlow);

// コンテキストに渡す値を定義
FxFlow.setContext({
  saveTrigger: save$,
  statusStream: (statusMessage as any).stream,
  finalMessage: remap(v => `Count was saved at: ${v}`)(count),
  alwaysTrue: () => true
});

コアコンセプト

    Stream: イベントの「可能性の流れ」。mapやfilterで合成可能な、リアクティブの源泉です。

    Prop: Streamからholdまたはaccumで生成される「確定した状態」。UIに直接バインドできます。

    jshtml: StreamやPropを埋め込める、宣言的なDOM構築のための記法です。

    into: DOMイベントをStreamに流し込むための「接着剤」。

    fx-effect: 副作用のフロー全体を管理するコンテナ。run/executeエンジンを内包します。

    <fx-*>要素群: sequence, call, waitなど、副作用の手順を宣言的に記述するための「言語」です。