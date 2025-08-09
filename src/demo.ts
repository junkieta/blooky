// -- 0. 事前ロード ---
import { stream, accum, merge, hold, map, remap, dumpGraphDOT } from "./blooky";
import { into, jshtml } from "./blooky-dom";
import type { FxEffect } from "./blooky-fxdom";
import { fxdom,EffectElementTagNameMap } from "./blooky-fxdom-debugger";
// debuggerとしてdefine
fxdom.defineEffectElements(EffectElementTagNameMap);

// --- 1. アプリケーションの状態定義 (Props and Streams) ---
// 見分けのため、DripperStreamは名称+"$", Propは"$"+名称として命名している。
const increment$ = stream();
const decrement$ = stream();
const save$ = stream();
const confirmation$ = stream<'yes'|'no'>();
const statusMessageStream$ = stream<string>();

const changeCountStream = merge<number>((a,b)=>a+b)([map(() => 1)(increment$), map(() => -1)(decrement$)]);
const $count = accum((current: number, val) => current + val, 0)(changeCountStream);
const $statusMessage = hold('Ready.')(statusMessageStream$);
const $finalMessage = remap<string,number>((v) => `Saved Count:${v}`)($count);

// --- 2. UIの定義 (jshtml) ---

const AppUI = jshtml({
  div: [
    // 状態(Prop)をUIにバインド
    { p: ["Count: ", $count] },
    
    // イベントをStreamに接続
    { button: "+", $: { onclick: into(increment$) } },
    { button: "-", $: { onclick: into(decrement$) } },
    { button: "Save", $: { onclick: into(save$), style: { marginLeft: '1em' } } },
    
    // 副作用の状態を表示
    { div: $statusMessage, $: { id: "status" } },

    // 確認用のボタン
    { div: [
        "Confirm here: ",
        { button: "Yes", $: { onclick: () => into(confirmation$)('yes') } },
        { button: "No", $: { onclick: () => into(confirmation$)('no') } },
      ],
      $: { style: { marginTop: '1em' } }
    }

  ]
});

// コンテキストとして渡すためのJSオブジェクト
const rootContext = {
    log: (s:unknown)=>console.log(s),
    save$,
    statusMessageStream$,
    confirmation$,
    $count,
    $finalMessage
};

const useKeys = Object.keys(rootContext);

// --- 副作用フローの宣言的な定義 (fxdom) ---
const fxEffectElement = jshtml({
    $: {
        use: useKeys.join(),
        "onsave": into(save$),
    },
    "fx-effect": 
    [
        { "fx-take": null,
            $: { "stream-key": "save$" } },
        // 1. 確認メッセージを表示
        { "fx-drip": null, 
            $: { "stream-key": "statusMessageStream$", value: '"Confirmation needed: Save this count? (Click Yes/No)"' } },
        // 2. confirmationStreamから値が流れてくるのを待つ
        { "fx-take": null,
            $: { "stream-key": "confirmation$" } },
        // 3. 結果に応じて処理を分岐
        { "fx-switch": [
            // "yes"の場合のフロー
            { "fx-sequence": [
                { "fx-drip": null,
                    $: { "stream-key": "statusMessageStream$", value: '"Saving..."' } },
                { "fx-wait": null,
                    $: { ms: "1500" } },
                { "fx-drip": null,
                    $: { "stream-key": "statusMessageStream$", value: '$finalMessage' } },
                { "fx-dispatch": { "fx-call": { arg: '"save complete"' }, $: { fn: "log" } },
                    $: { name: "save" } }
                ], 
                $: { slot: "yes" }
            },
            // "no"またはdefaultの場合のフロー
            { "fx-drip": null, 
                $: { slot: "default", "stream-key": "statusMessageStream$", value: '"Save cancelled."' }
            }
            ],
            $: { by: "lastResult" }
        }
    ],
}) as FxEffect;

// Stream/Prop構造のdot
const dot = jshtml({
    pre: dumpGraphDOT({
        increment$,
        decrement$,
        changeCountStream,
        $count,
        statusMessageStream$,
        $statusMessage,
        $finalMessage
    }), $: { class : "dot" }
});

// --- 3. アプリケーションのマウントとコンテキスト設定 ---

// コンテキストの設定
fxEffectElement.setContext(rootContext);

// UIをDOMにマウントする
document.body.append(AppUI, fxEffectElement, dot);
