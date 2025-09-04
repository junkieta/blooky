// -- 0. 事前ロード ---
import { stream, accum, merge, hold, map, remap, when, lift } from "./blooky-fp";
import { jshtml } from "./blooky-dom";
import type { FxEffect } from "./blooky-fxdom";
import { fxdom,EffectElementTagNameMap, dumpGraphDOT } from "./blooky-devtools";
// dot視覚化用にviz
import { instance as viz_instance } from "@viz-js/viz";
import { fx, ref } from "./blooky-fx";
import { FxContextNode } from "./fx/types";
import { fc } from "./blooky-fc";

// debuggerとしてdefine
fxdom.defineEffectElements(EffectElementTagNameMap);

// --- 1. アプリケーションの状態定義 (Props and Streams) ---
// 見分けのため、DripperStreamは名称+"$", Propは"$"+名称として命名している。
const increment$ = stream();
const decrement$ = stream();
const save$ = stream();
const $triggerSave = hold(false)(map(()=>true)(save$));

const statusMessageStream$ = stream<string>();
const changeCountStream = merge<number>((a,b)=>a+b)([map(() => 1)(increment$), map(() => -1)(decrement$)]);
const $count = accum((current: number, val: number) => current + val, 0)(changeCountStream);
const $statusMessage = hold('Ready.')(statusMessageStream$);
const $finalMessage = remap<string,number>((v) => `Saved Count:${v}`)($count);

// confirmの呼び出しを別ツリーのフローとして宣言
const fxConfirm = fx.context({},fx.sequence([
    fx.call((text)=>confirm(text) ? "yes" : "no", { arg: ref("yieldedValue"), id: "confirmResult" }),
    fx.return(ref("#confirmResult")),
])) as FxContextNode;

const context = {
    increment$,
    decrement$,
    save$,
    $triggerSave,
    statusMessageStream$,
    changeCountStream,
    $count,
    $statusMessage,
    $finalMessage,
    fxConfirm,
    log: (s:unknown)=>console.log(s),
};

// --- 2. UIの定義 (jshtml) ---

const AppUI = fc.prime(context)(({$count,increment$,decrement$,save$,$statusMessage}) => jshtml({
  div: [
    // 状態(Prop)をUIにバインド
    { p: ["Count: ", $count] },
    // イベントをStreamに接続
    { button: "+", $: { onclick: increment$ } },
    { button: "-", $: { onclick: decrement$ } },
    { button: "Save", $: { onclick: save$, style: { marginLeft: '1em' } } },
    // 副作用の状態を表示
    { div: $statusMessage, $: { id: "status" } },
  ]
}));

// --- 副作用フローの宣言的な定義 (fxdom) ---
const fxEffectElement = jshtml({
    $: { "onsave": save$, },
    "fx-effect": 
    [
        { "fx-wait": jshtml.$({ "until": "$triggerSave" }) },
        // 1. 確認メッセージを表示
        { "fx-yield": '"Confirmation needed: Save this count?"', $: { for: "fxConfirm", id: "confirmResult" } },
        { "fx-switch": [
            // "yes"の場合のフロー
            { "fx-sequence": [
                { "fx-collapse": '"Saving..."', $: { "dripper": "statusMessageStream$" } },
                { "fx-wait": jshtml.$({ ms: 1500 }) },
                { "fx-collapse": jshtml.$({ "dripper": "statusMessageStream$", value: '$finalMessage' }) },
                { "fx-call": '"save complete"', $: { fn: "log" } },
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
const dot = dumpGraphDOT(context);

const renderDot = async (dot: string) => {
    const viz = await viz_instance();
    return viz.renderSVGElement(dot);
}

// --- 3. アプリケーションのマウントとコンテキスト設定 ---

// コンテキストの設定
fxEffectElement.setContext(context);

// UIをDOMにマウントする
document.body.append(AppUI, fxEffectElement, jshtml(renderDot(dot)));

