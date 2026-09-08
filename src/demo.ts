// src/demo.ts
import { stream, accum, merge, hold, map, remap, pipe } from "./blooky-fp";
import { createFV } from "./blooky-fv";
import { fxdom, EffectElementTagNameMap, dumpGraphDOT, executeByElement } from "./blooky-devtools";
import { instance as viz_instance } from "@viz-js/viz";
import { JSHTMLNodeSource } from "./blooky-fv-types";
import { DripperStream, Prop } from "./blooky-fp-types";
import { clock } from "./runtime/clock";
import { FxEffectElement } from "./blooky-fxdom";
import { EffectOutcome } from "./blooky-fx-types";

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
        { "fx-call": jshtml.$({ action: "identity", input: "$_", done: confirmQuestionActivated$ }) },
        { "fx-wait": jshtml.$({ until: $confirmAnswerResolved }) },
        { "fx-return": jshtml.$({ value: $selectedConfirmAnswer }) }
      ],  
      $: { id: "fxConfirm" }
    },
    { "fx-wait": jshtml.$({ "until": $triggerSave }) },
    { "fx-yield": '"Confirmation needed: Save this count?"', $: { for: "#fxConfirm", id: "confirmResult" } },
    {
      "fx-switch": [
        {
          "fx-sequence": [
            { "fx-call": '"Saving..."', $: { action: "identity", done: statusMessageStream$ } },
            { "fx-wait": jshtml.$({ timer: 1500 }) },
            { "fx-call": jshtml.$({ action: "identity", input: $finalMessage, done: statusMessageStream$ }) },
            { "fx-call": '"save complete"', $: { action: "log" } },
          ],
          $: { slot: "yes" }
        },
        {
          "fx-call": '"Save cancelled."',
          $: { slot: "default", action: "identity", done: statusMessageStream$ }
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
type FxResult<T> = EffectOutcome<T>;
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
  { p: res.kind === "value" ? res.value : JSON.stringify(res) },
  { button: "OK", $: { onclick: confirmButtonClicked$, value: "yes" } },
  { button: "Cancel", $: { onclick: confirmButtonClicked$, value: "no" } },
])(confirmQuestionActivated$));

// --- 3. データフローの生成 ---
const increment$ = stream();
const decrement$ = stream();
const save$ = stream();
const $triggerSave = hold(false)(map(() => true)(save$));

const statusMessageStream$ = stream<FxResult<string>>();
const changeCountStream = merge([map(() => 1)(increment$), map(() => -1)(decrement$)], ((v) => v.reduce((a,b)=>a+b)));
const $count = accum((current: number, val: number) => current + val, 0)(changeCountStream);
const $statusMessage = hold('Ready.')(map<FxResult<string>,string>((r)=> r.kind === "value" ? r.value : JSON.stringify(r) )(statusMessageStream$));
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

renderDot(dot).then((graph)=>{
  document.body.append(
    AppUIRenderer(context),
    EffectRenderer(context),
    jshtml([graph, { pre: dot }])
  );
})


