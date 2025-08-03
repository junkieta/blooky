
// --- 1. アプリケーションの状態定義 (Props and Streams) ---

import { stream, accum, merge, hold, drip, pipe } from "./blooky";
import { jshtml } from "./blooky-dom";
import type { FxEffect } from "./blooky-fxdom";
import { fxdom,EffectElementTagNameMap } from "./blooky-fxdom-debugger";

// debuggerとしてdefine
fxdom.defineEffectElements(EffectElementTagNameMap);

const increment$ = stream<void>();
const decrement$ = stream<void>();
const save$ = stream<void>();
const confirmation$ = stream<'yes' | 'no'>();

const count = accum(
  merge([pipe(increment$)(() => 1), pipe(decrement$)(() => -1)])((a,b)=>a+b)
)((current, val) => current + val, 0);

const statusMessageStream = stream<string>();
const statusMessage = hold(statusMessageStream)('Ready.');

// --- 2. UIの定義 (jshtml) ---

const AppUI = jshtml({
  div: [
    // 状態(Prop)をUIにバインド
    { p: ["Count: ", count] },
    
    // イベントをStreamに接続
    //【修正】 `_`プロパティを廃止し、テキストコンテンツをキーの値として直接指定
    { button: "+", $: { onclick: drip(increment$) } },
    { button: "-", $: { onclick: drip(decrement$) } },
    { button: "Save", $: { onclick: drip(save$), style: { marginLeft: '1em' } } },
    
    // 副作用の状態を表示
    { div: statusMessage, $: { id: "status" } },

    // 確認用のボタン
    { div: [
        "Confirm here: ",
        { button: "Yes", $: { onclick: () => drip(confirmation$)('yes') } },
        { button: "No", $: { onclick: () => drip(confirmation$)('no') } },
      ],
      $: { style: { marginTop: '1em' } }
    }
  ]
});

// コンテキストとして渡すためのJSオブジェクト
const rootContext = {
    log: (s:unknown)=>console.log(s),
    save: save$,
    statusMessageStream,
    confirmationStream: confirmation$,
    countProp: count,
    saveFinalMessage: () => {
        // 状態(Prop)の現在値を取得してメッセージを組み立てる
        const finalMessage = `Saved count: ${count()}`;
        // statusMessageStreamに直接dripする
        drip(statusMessageStream)(finalMessage);
    }
};


// --- 副作用フローの宣言的な定義 (fxdom) ---
const fxEffectElement = jshtml({
    $: {
        use: "statusMessageStream, confirmationStream, countProp, saveFinalMessage, log",
        // <fx-effect>のイベントハンドラ
        "onsave": drip(save$),
    },
    "fx-effect": 
    [
    { "fx-sequence": [
        { "fx-take": null,
            $: { "stream-key": "save" }
        },
        // 1. 確認メッセージを表示
        { "fx-drip": null, 
            $: { "stream-key": "statusMessageStream", value: '"Confirmation needed: Save this count? (Click Yes/No)"' } },
        // 2. confirmationStreamから値が流れてくるのを待つ
        { "fx-take": null,
            $: { "stream-key": "confirmationStream" } },
        // 3. 結果に応じて処理を分岐
        { "fx-switch": [
            // "yes"の場合のフロー
            { "fx-sequence": [
                { "fx-drip": null,
                    $: { "stream-key": "statusMessageStream", value: '"Saving..."' } },
                { "fx-wait": null,
                    $: { ms: "1500" } },
                { "fx-call": null,
                    $: { fn: "saveFinalMessage" } },
                { "fx-dispatch": null,
                    $: { name: "save" }
                }
                ], 
                $: { slot: "yes" }
            },
            // "no"またはdefaultの場合のフロー
            { "fx-drip": null, 
                $: { slot: "default", "stream-key": "statusMessageStream", value: '"Save cancelled."' }
            }
            ],
            $: { by: "lastResult" }
        }
        ]
    }
    ],
}) as FxEffect;


// --- 3. アプリケーションのマウントとコンテキスト設定 ---

// コンテキストの設定
fxEffectElement.setContext(rootContext);

// UIをDOMにマウントする
document.body.append(AppUI, fxEffectElement);
