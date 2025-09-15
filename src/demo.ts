// -- 0. 事前ロード ---
import { stream, accum, merge, hold, map, remap, when, lift, Prop, pipe, DripperStream, PromisedProp } from "./blooky-fp";
import { jshtml, prime } from "./blooky-dom";
import { fxdom,EffectElementTagNameMap, dumpGraphDOT } from "./blooky-devtools";
// dot視覚化用にviz
import { instance as viz_instance } from "@viz-js/viz";
import { JSHTMLNodeSource } from "./blooky-dom-types";

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
const confirmQuestionActivated$ = stream<string>();
const confirmButtonClicked$ = stream<MouseEvent>();
const $selectedConfirmAnswer = pipe(
    confirmButtonClicked$,
    map((evt)=>(evt.target as HTMLButtonElement).value),
    hold("yet")
);

const $confirmAnswerResolved = when<string>((answer)=>answer !== "yet")($selectedConfirmAnswer);

const $confirmQuestionDialogbox = hold<JSHTMLNodeSource>(null)(map<JSHTMLNodeSource, string>((text)=>[
    { p: text },
    { button: "OK", $: { onclick: confirmButtonClicked$, value: "yes" } },
    { button: "Cancel", $: { onclick: confirmButtonClicked$, value: "no" } },
])(confirmQuestionActivated$));

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
    confirmQuestionActivated$,
    $selectedConfirmAnswer,
    $confirmAnswerResolved,
    $confirmQuestionDialogbox,
    log: (s:unknown)=>console.log(s),
};

// --- 2. UIの定義 (jshtml) ---
interface AppUIContext {
    $count: Prop<number>
    increment$: DripperStream<void>
    decrement$: DripperStream<void>
    save$: DripperStream<void>
    $statusMessage: Prop<JSHTMLNodeSource>
    $confirmQuestionDialogbox: Prop<JSHTMLNodeSource>
}

const AppUIRenderer = prime(({$count,increment$,decrement$,save$,$statusMessage,$confirmQuestionDialogbox}:AppUIContext) => ({
  div: [
    // 状態(Prop)をUIにバインド
    { p: ["Count: ", $count] },
    // イベントをStreamに接続
    { button: "+", $: { onclick: increment$ } },
    { button: "-", $: { onclick: decrement$ } },
    { button: "Save", $: { onclick: save$, style: { marginLeft: '1em' } } },
    // 副作用の状態を表示
    { div: $statusMessage, $: { id: "status" } },
    { aside: $confirmQuestionDialogbox }
  ]
}));



// --- 副作用フローの宣言的な定義 (fxdom) ---
interface EffectContext {
    confirmQuestionActivated$: DripperStream<string>,
    $confirmAnswerResolved: PromisedProp<string>,
    $selectedConfirmAnswer: Prop<string>,
    $triggerSave: Prop<boolean>,
    statusMessageStream$: DripperStream<string>,
    $finalMessage: Prop<string>,
    save$: DripperStream<void>
}

const EffectRenderer = prime(({
    confirmQuestionActivated$,
    $confirmAnswerResolved,
    $selectedConfirmAnswer,
    $triggerSave,
    statusMessageStream$,
    $finalMessage,
    save$
}:EffectContext) => ({
    "fx-effect": 
    [
        { "fx-context": [
            { "fx-collapse": jshtml.$({ dripper: confirmQuestionActivated$, value: "yieldedValue" }) },
            { "fx-wait": jshtml.$({ until: $confirmAnswerResolved }) },
            { "fx-return": jshtml.$({ value: $selectedConfirmAnswer }) }
            ],
            $: { id: "fxConfirm" }
        },
        { "fx-wait": jshtml.$({ "until": $triggerSave }) },
        // 1. 確認メッセージを表示
        { "fx-yield": '"Confirmation needed: Save this count?"', $: { for: "#fxConfirm", id: "confirmResult" } },
        { "fx-switch": [
            // "yes"の場合のフロー
            { "fx-sequence": [
                { "fx-collapse": '"Saving..."', $: { dripper: statusMessageStream$ } },
                { "fx-wait": jshtml.$({ ms: 1500 }) },
                { "fx-collapse": jshtml.$({ dripper: statusMessageStream$, value: $finalMessage }) },
                { "fx-call": '"save complete"', $: { fn: "log" } },
                ], 
                $: { slot: "yes" }
            },
            // "no"またはdefaultの場合のフロー
            { "fx-collapse": '"Save cancelled."',
                $: { slot: "default", "dripper": statusMessageStream$ } }
            ],
            $: { by: "#confirmResult" }
        }
    ],
    $: { "onsave": save$, },
}));

// Stream/Prop構造のdot
const dot = dumpGraphDOT(context);

const renderDot = async (dot: string) => {
    const viz = await viz_instance();
    return viz.renderSVGElement(dot);
}

// --- 3. アプリケーションのマウント ---

// UIをDOMにマウントする
document.body.append(
    AppUIRenderer(context),
    EffectRenderer(context),
    jshtml([renderDot(dot)/* jshtmlはPromiseを透過的に処理する */, { pre: dot }])
);
