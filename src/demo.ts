// -- 0. 事前ロード ---
import { stream, accum, merge, hold, map, remap, when, lift } from "./blooky-fp";
import { collapse, jshtml } from "./blooky-dom";
import type { FxContext, FxEffect } from "./blooky-fxdom";
import { fxdom,EffectElementTagNameMap, dumpGraphDOT } from "./blooky-devtools";
// dot視覚化用にviz
import { instance as viz_instance } from "@viz-js/viz";
import { fx, ref } from "./fx/engine";
import { FxContextNode } from "./fx/types";

// debuggerとしてdefine
fxdom.defineEffectElements(EffectElementTagNameMap);

// --- 1. アプリケーションの状態定義 (Props and Streams) ---
// 見分けのため、DripperStreamは名称+"$", Propは"$"+名称として命名している。
const increment$ = stream();
const decrement$ = stream();
const save$ = stream();
const $triggerSave = hold(false)(map(()=>true)(save$));
const confirmation$ = stream<'yes'|'no'|"yet">();
const $confirmResult = hold<"yes"|"no"|"yet">("yet")(confirmation$);
const $decideConfirm = lift(([save,confirm])=>save && confirm !== "yet")([$triggerSave,$confirmResult]);

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
    { button: "+", $: { onclick: collapse(increment$) } },
    { button: "-", $: { onclick: collapse(decrement$) } },
    { button: "Save", $: { onclick: collapse(save$), style: { marginLeft: '1em' } } },
    
    // 副作用の状態を表示
    { div: $statusMessage, $: { id: "status" } },

    // 確認用のボタン
    { div: [
        "Confirm here: ",
        { button: "Yes", $: { onclick: () => collapse(confirmation$)('yes') } },
        { button: "No", $: { onclick: () => collapse(confirmation$)('no') } },
      ],
      $: { style: { marginTop: '1em' } }
    }

  ]
});

const yesOrNo = (cond: boolean) => cond ? "yes" : "no";

// confirmの呼び出しを別ツリーのフローとして宣言
const fxConfirm = fx.context({},fx.sequence([
    fx.call((text)=>yesOrNo(confirm(text)), { arg: ref("yieldedValue"), id: "confirmResult" }),
    fx.return(ref("#confirmResult")),
])) as FxContextNode;

// コンテキストとして渡すためのJSオブジェクト
const rootContext = {
    log: (s:unknown)=>console.log(s),
    fxConfirm,
    save$,
    $triggerSave,
    statusMessageStream$,
    confirmation$,
    $confirmResult,
    $decideConfirm,
    $count,
    $finalMessage
};

const useKeys = Object.keys(rootContext);

// --- 副作用フローの宣言的な定義 (fxdom) ---
const fxEffectElement = jshtml({
    $: {
        use: useKeys.join(),
        "onsave": collapse(save$),
    },
    "fx-effect": 
    [
        { "fx-wait": jshtml.$({ "until": "$triggerSave" }) },
        // 1. 確認メッセージを表示
        { "fx-yield": '"Confirmation needed: Save this count?"',
            $: { for: "fxConfirm", id: "confirmResult" } },
        { "fx-switch": [
            // "yes"の場合のフロー
            { "fx-sequence": [
                { "fx-collapse": '"Saving..."', $: { "dripper": "statusMessageStream$" } },
                { "fx-wait": jshtml.$({ ms: 1500 }) },
                { "fx-collapse": jshtml.$({ "dripper": "statusMessageStream$", value: '$finalMessage' }) },
                { "fx-dispatch":
                    { "fx-call": '"save complete"', $: { fn: "log" } },
                    $: { name: "save" } }
                ], 
                $: { slot: "yes" }
            },
            // "no"またはdefaultの場合のフロー
            { "fx-collapse": '"Save cancelled."',
                $: { slot: "default", "dripper": "statusMessageStream$" } }
            ],
            $: { by: "#confirmResult" }
        }
    ],
}) as FxEffect;

// Stream/Prop構造のdot
const dot = dumpGraphDOT({
    increment$,
    decrement$,
    changeCountStream,
    $count,
    statusMessageStream$,
    $statusMessage,
    $finalMessage
});


const renderDot = async (dot: string) => {
    const viz = await viz_instance();
    return viz.renderSVGElement(dot);
}

// --- 3. アプリケーションのマウントとコンテキスト設定 ---

// コンテキストの設定
fxEffectElement.setContext(rootContext);

// UIをDOMにマウントする
document.body.append(AppUI, fxEffectElement, jshtml(renderDot(dot)));

