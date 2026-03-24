import { createFV, JSHTMLNodeSource } from "./blooky-fv";
import { fxdom, EffectElementTagNameMap } from "./blooky-devtools";
import { clock } from "./runtime/clock";
import { Prop, DripperStream } from "./blooky-fp-types";
import { stream, accum, merge, map } from "./blooky-fp";

const {prime} = createFV(clock);


// debuggerとしてdefine（自動的にデバッグパネルが表示される）
//fxdom.defineEffectElements(EffectElementTagNameMap);


// --- UIの定義 ---
interface CounterUIContext {
  $count: Prop<number>
  increment$: DripperStream<void>
  decrement$: DripperStream<void>
}

const CounterUI = prime(({ $count, increment$, decrement$ }: CounterUIContext) => ({
  div: [
    { p: ["Count: ", $count] },
    { button: "+", $: { onclick: increment$ } },
    { button: "-", $: { onclick: decrement$ } },
  ]
}));

// --- データフローの生成 ---
const increment$ = stream();
const decrement$ = stream();
const changeCountStream = 
    merge([
        map(() => 1)(increment$),
        map(() => -1)(decrement$)
    ], ((a, b) => a + b));
const $count = accum((current: number, val: number) => current + val, 0)(changeCountStream);

const counter = CounterUI({ $count, increment$, decrement$ });

document.getElementById("s1").append(counter);
