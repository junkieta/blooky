import { stream, commit, accum } from "./blooky-fp";
import { createFV } from "./blooky-fv";
import type { Prop, Dripper, DripPlan } from "./blooky-fp-types";
import { clock } from "./runtime/clock";

function main() {
  const logEl = document.getElementById("log") as HTMLPreElement;
  const log = (s: string) => {
    logEl.textContent += s + "\n";
  };

  // runtime + fv
  const fv = createFV(clock);

  // ---- FRP graph ----
  // click$ : Dripper<MouseEvent>
  // count$ : Prop<number> (hold + map)
  const click$ = stream<MouseEvent>();

  // count$ を self-referential に更新（最小デモ用）
  let $count: Prop<number> = accum<number,Event>((v)=>v+1, 0)(click$);

  // ---- UI (prime) ----
  const App = fv.prime(({ click$, $count }: { click$: Dripper<MouseEvent>, $count: Prop<number> }) => ({
    div: [
      { h2: "Prime + Prop update + runtime.submitPlan demo" },
      { p: ["Text updates via Prop: count = ", $count] },
      { button: "increment", $: { onclick: click$ } },
      {
        p: "Flow: onclick(Dripper) -> drip(plan) -> runtime.submitPlan -> fp.commit -> runtime.observeCommit(update) -> DOM patch",
      },
    ],
  }));

  // mount
  const mount = document.getElementById("mount")!;
  mount.appendChild(App({ click$, $count }));

  // 境界イベント（任意）
  document.addEventListener("blooky-commit-start", (e) => log(`DOM event: ${(e as Event).type}`));
  document.addEventListener("blooky-commit-completed", (e) => log(`DOM event: ${(e as Event).type}`));
  log("ready.");
}

main();
