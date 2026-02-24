// src/demo.ts
import { stream, accum, merge, hold, map, remap, pipe } from "./blooky-fp";
import { createFV } from "./blooky-fv";
import { fxdom, EffectElementTagNameMap, dumpGraphDOT, executeByElement } from "./blooky-devtools";
import { instance as viz_instance } from "@viz-js/viz";
import { JSHTMLNodeSource } from "./blooky-fv-types";
import { DripperStream, Prop } from "./blooky-fp-types";
import { clock } from "./runtime/clock";
import { FxEffectElement } from "./blooky-fxdom";

const {prime,jshtml} = createFV(clock);

// debuggerとしてdefine（自動的にデバッグパネルが表示される）
fxdom.defineEffectElements(EffectElementTagNameMap);

// --- 1. 実行フローの定義 ---
interface EffectContext {
  confirmQuestionActivated$: DripperStream<FxResult<string>>
  $confirmAnswerResolved: Prop<boolean>,
  $selectedConfirmAnswer: Prop<string>,
  $triggerSave: Prop<boolean>,
  statusMessageStream$: DripperStream<FxResult<string>>,
  $finalMessage: Prop<string>,
  save$: DripperStream<void>,
  identity: (v:any)=>any
}

const EffectRenderer = prime(({
  confirmQuestionActivated$,
  $confirmAnswerResolved,
  $selectedConfirmAnswer,
  $triggerSave,
  statusMessageStream$,
  $finalMessage,
  save$,
}: EffectContext) => ({
  "fx-effect": [
    {
      "template": [
        { "fx-call": jshtml.$({ fn: "identity", arg: "$_", done: confirmQuestionActivated$ }) },
        { "fx-wait": jshtml.$({ until: $confirmAnswerResolved }) },
        { "fx-return": jshtml.$({ value: $selectedConfirmAnswer }) }
      ],  
      $: { id: "fxConfirm" }
    },
    { "fx-wait": jshtml.$({ "until": $triggerSave }) },
    { "fx-yield": '"Confirmation needed: Save this count?"', $: { score: "#fxConfirm", id: "confirmResult" } },
    {
      "fx-switch": [
        {
          "fx-sequence": [
            { "fx-call": '"Saving..."', $: { fn: "identity", done: statusMessageStream$ } },
            { "fx-wait": jshtml.$({ ms: 1500 }) },
            { "fx-call": jshtml.$({ fn: "identity", arg: $finalMessage, done: statusMessageStream$ }) },
            { "fx-call": '"save complete"', $: { fn: "log" } },
          ],
          $: { slot: "yes" }
        },
        {
          "fx-call": '"Save cancelled."',
          $: { slot: "default", fn: "identity", done: statusMessageStream$ }
        }
      ],
      $: { by: "#confirmResult" }
    }
  ],
  $: { "onsave": save$, ignite: "quantum" },
}));

// --- 2. UIの定義 ---
interface AppUIContext {
  $count: Prop<number>
  increment$: DripperStream<void>
  decrement$: DripperStream<void>
  save$: DripperStream<void>
  $statusMessage: Prop<JSHTMLNodeSource>
  $confirmQuestionDialogbox: Prop<JSHTMLNodeSource>
}

const AppUIRenderer = prime(({ $count, increment$, decrement$, save$, $statusMessage, $confirmQuestionDialogbox }: AppUIContext) => ({
  div: [
    { p: ["Count: ", $count], $: { style: { color: $colorOfCount } } },
    { button: "+", $: { onclick: increment$ } },
    { button: "-", $: { onclick: decrement$ } },
    { button: "Save", $: { onclick: save$, style: { marginLeft: '1em' } } },
    { div: $statusMessage, $: { id: "status" } },
    { aside: $confirmQuestionDialogbox }
  ]
}));

// confirm dialog
type FxResult<T> = 
  | { ok: true, value: T }
  | { ok: false, error: Error };
const confirmQuestionActivated$ = stream<FxResult<string>>();
const confirmButtonClicked$ = stream<MouseEvent>();
const $selectedConfirmAnswer = pipe(
  confirmButtonClicked$,
  map((evt) => (evt.target as HTMLButtonElement).value),
  hold("yet")
);
const $confirmAnswerResolved = remap<string,boolean>((resolved)=>resolved !== "yet")($selectedConfirmAnswer);
const $confirmQuestionDialogbox = hold<JSHTMLNodeSource>(null)(map<FxResult<string>,JSHTMLNodeSource>((res) => 
[
  { p: res.ok === true ? res.value : res.error.message },
  { button: "OK", $: { onclick: confirmButtonClicked$, value: "yes" } },
  { button: "Cancel", $: { onclick: confirmButtonClicked$, value: "no" } },
])(confirmQuestionActivated$));

// --- 3. データフローの生成 ---
const increment$ = stream();
const decrement$ = stream();
const save$ = stream();
const $triggerSave = hold(false)(map(() => true)(save$));

const statusMessageStream$ = stream<FxResult<string>>();
const changeCountStream = merge([map(() => 1)(increment$), map(() => -1)(decrement$)], ((a, b) => a + b));
const $count = accum((current: number, val: number) => current + val, 0)(changeCountStream);
const $statusMessage = hold('Ready.')(map<FxResult<string>,string>((r)=> r.ok === true ? r.value : r.error.message )(statusMessageStream$));
const $finalMessage = remap<number, string>((v) => `Saved Count:${v}`)($count);
const $colorOfCount = remap<number, string>((count) => count % 3 ? "blue" : "red")($count);

const context = {
  increment$,
  decrement$,
  save$,
  $triggerSave,
  statusMessageStream$,
  changeCountStream,
  $count,
  $colorOfCount,
  $statusMessage,
  $finalMessage,
  confirmQuestionActivated$,
  $selectedConfirmAnswer,
  $confirmAnswerResolved,
  $confirmQuestionDialogbox,
  identity: <V>(v: V) => v,
  log: (s: unknown) => console.log(s),
};



// --- 4. グラフ可視化 ---
const dot = dumpGraphDOT(context);
const renderDot = async (dot: string) => {
  const viz = await viz_instance();
  return viz.renderSVGElement(dot);
}

// --- 5. マウント ---
const mo = new MutationObserver((records)=>{
  const nodes = records.flatMap((r)=>Array.from(r.addedNodes));
  nodes.filter((n) => n.nodeName.toLowerCase() === "fx-effect").forEach((effect)=>{
    executeByElement(effect as FxEffectElement, context);
  })
});

mo.observe(document.body, { subtree: true, childList: true });

document.body.append(
  AppUIRenderer(context),
  EffectRenderer(context),
  jshtml([renderDot(dot), { pre: dot }])
);

