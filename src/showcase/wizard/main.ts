/**
 * blooky showcase — wizard demo
 *
 * Score vs Performance: fx-yield による template 委譲と
 * fx-switch による戻り値分岐を示すデモ。
 *
 * FRP 設計原則：
 * - フェーズ遷移は phase$ へのデータフローで表現する
 * - UI は $phase から派生した単一の宣言的ツリー
 * - render 関数・innerHTML・observeStep による UI 操作は持たない
 * - restart$ が全状態リセットの唯一のイベント源
 *
 * シナリオ：アカウント登録ウィザード
 *   Step1: メール入力
 *   Step2: プラン選択 (Free / Pro)
 *   Step3: 確認
 *   → fx-switch で Free / Pro の後処理に分岐
 */

import { fxdom, EffectElementTagNameMap, executeByElement } from "../../blooky-devtools";
import { stream, hold, map, merge, remap, lift, Dripper, Prop } from "../../blooky-fp";
import { createFV, JSHTMLNodeSource } from "../../blooky-fv";
import { FxEffectElement } from "../../blooky-fxdom";
import { clock } from "../../runtime/clock";

const { prime, jshtml } = createFV(clock);
fxdom.defineEffectElements(EffectElementTagNameMap);

// ─── 1. FRP Core ──────────────────────────────────────────────────────────

type Phase = "email" | "plan" | "confirm" | "done-free" | "done-pro" | "api-ready";

const phaseNames: Phase[] = ["email","plan","confirm","done-free","done-pro","api-ready"];
const restart$ = stream<void>();

// restart$ はフェーズを "email" に戻す
const finishPhaseAction$ = stream<Event>();
const endOfPhase$ = map<Event,Phase>((e)=>(e.target as HTMLButtonElement).value as Phase)(finishPhaseAction$);
const doneConfirmResult$ = stream<"done-free"|"done-pro">();
const $phase = hold<Phase>("email")(merge<Phase>([
  map<Phase,Phase>((p) => phaseNames[phaseNames.indexOf(p)+1] ?? phaseNames[0])(
    merge([endOfPhase$,doneConfirmResult$])
  ),
  map((): Phase => phaseNames[0])(restart$),
]))

// フォーム値
const emailInput$ = stream<Event>();
const $email = hold("")(merge([
  map<Event, string>((e) => (e.target as HTMLInputElement).value)(emailInput$),
  map((): string => "")(restart$),
]));

const planSelect$ = stream<MouseEvent>();
const $plan = hold("free")(merge([
  map<Event,string>((e)=> {
    return (e.target as HTMLElement).closest("*[id]")!.getAttribute("data-plan") ?? "free"
  })(planSelect$),
  map((): string => "free")(restart$),
]));

const $emailEnd = remap((p)=> p !== "email"  )($phase);
const $planEnd = remap((p)=> p !== "plan"   )($phase);
const $confirmEnd = remap((p)=> p !== "confirm")($phase);

const log = (msg: unknown) => console.log("[wizard]", msg);

// ─── 3. Context ───────────────────────────────────────────────────────────

const fxContext = {
  $email, $plan, doneConfirmResult$,
  emailInput$, planSelect$,
  $emailEnd, $planEnd, $confirmEnd
};

// ─── 4. Score ─────────────────────────────────────────────────────────────
 
const WizardEffect = prime(({
  $email, $plan, doneConfirmResult$,
  $emailEnd, $planEnd, $confirmEnd
}: typeof fxContext) => ({
  "fx-effect": [
    {
      "fx-sequence": [
        { "fx-wait": jshtml.$({ until: $emailEnd }) },
        { "fx-wait": jshtml.$({ until: $planEnd }) },
        { "fx-wait": jshtml.$({ until: $confirmEnd }) },
        {
          "fx-switch": [
            {
              "fx-sequence": [
                { "fx-call": jshtml.$({ action: String, input: "done-free", done: doneConfirmResult$ }) },
                { "fx-call": jshtml.$({ action: "log",    id: "call-log-free" }) },
              ],
              $: { slot: "free" },
            },
            {
              "fx-sequence": [
                { "fx-call": jshtml.$({ action: String, input: "done-pro", done: doneConfirmResult$ }) },
                { "fx-call": jshtml.$({ action: "log",        id: "call-log-pro" }) },
                { "fx-wait": jshtml.$({ timer: 1500,           id: "wait-api"     }) },
                { "fx-call": jshtml.$({ action: String, input: "api-ready", done: doneConfirmResult$ }) },
                { "fx-call": jshtml.$({ action: "goApiReady",  id: "call-api-key" }) },
              ],
              $: { slot: "pro" },
            },
          ],
          $: { by: $plan, id: "switch-plan" },
        },
      ],
      $: { id: "wizard-seq" },
    },
  ],
  $: { id: "wizard-effect" },
}));

// ─── 5. Reactive UI ───────────────────────────────────────────────────────
// $phase から派生した純粋な宣言的ツリー。render関数なし。

// ステッパー（フェーズ → アクティブインデックス）
const phaseToStep: Record<Phase, number> = {
  "email": 0, "plan": 1, "confirm": 2,
  "done-free": 3, "done-pro": 3, "api-ready": 3,
};

const stepperItem = (num: string, label: string, targetPhases: Phase[]) => {
  const $cls = remap((p: Phase) => {
    const active = phaseToStep[p];
    const idx = parseInt(num) - 1;
    return "step-item" + (targetPhases.includes(p) ? " active" : active > idx ? " done" : "");
  })($phase);
  return { div: [{ div: num, $: { class: "step-num" } }, { span: label }], $: { class: $cls } };
};

// プランカードのクラス（モジュールスコープで一度だけ生成）
const $freePlanClass = remap((p: string) => "plan-card" + (p === "free" ? " selected" : ""))($plan);
const $proPlanClass  = remap((p: string) => "plan-card" + (p === "pro"  ? " selected" : ""))($plan);

// 確認画面のプラン表示
const $planLabel = remap((p: string) => p === "pro" ? "Pro  ¥2,980/月" : "Free  ¥0/月")($plan);
const $planLabelCls = remap((p: string) => "summary-val " + (p === "pro" ? "plan-pro" : "plan-free"))($plan);

// ステップカードの内容（$phase から派生）

const emailCard = prime(({emailInput$}:{emailInput$:Dripper<Event>})=>({
  fieldset: [
    { legend: "Step 1 / メールアドレス", $: { class: "step-title" } },
    {
      div: [
        { label: "email", $: { for: "email-inp" } },
        { input: jshtml.$({ type: "email", id: "email-inp", placeholder: "you@example.com", required: true, oninput: emailInput$ }) },
      ],
      $: { class: "field" },
    },
    { button: "Next →", $: { class: "btn btn-primary", value: "email", onclick: finishPhaseAction$ } },
  ],
  $: { class: "step-inner" },
}));

const planCard = prime(({planSelect$,$freePlanClass,$proPlanClass}:{
  planSelect$: Dripper<MouseEvent>
  $freePlanClass:Prop<string>
  $proPlanClass:Prop<string>
})=>({
  fieldset: [
    { legend: "Step 2 / プランを選択", $: { class: "step-title" } },
    {
      div: [
        {
          div: [
            { div: "Free",    $: { class: "plan-name"  } },
            { div: "¥0 / 月", $: { class: "plan-price" } },
          ],
          $: { class: $freePlanClass, id: "card-free", dataset: { plan: "free" } },
        },
        {
          div: [
            { div: "Pro",         $: { class: "plan-name"  } },
            { div: "¥2,980 / 月", $: { class: "plan-price" } },
          ],
          $: { class: $proPlanClass, id: "card-pro", dataset: { plan: "pro" } },
        },
      ],
      $: { onclick: planSelect$, class: "plan-cards" },
    },
    { button: "Next →", $: { class: "btn btn-primary", value: "plan", onclick: finishPhaseAction$ } },
  ],
  $: { class: "step-inner" },
}));

const confirmCard = prime(({
  $email,$planLabel,$planLabelCls
}:{
  $email: Prop<string>
  $planLabel: Prop<string>
  $planLabelCls: Prop<string>
})=>({
  fieldset: [
    { legend: "Step 3 / 確認", $: { class: "step-title" } },
    {
      div: [
        {
          div: [
            { span: "email", $: { class: "summary-key" } },
            { span: $email,  $: { class: "summary-val" } },
          ],
          $: { class: "summary-row" },
        },
        {
          div: [
            { span: "plan",       $: { class: "summary-key" } },
            { span: $planLabel,   $: { class: $planLabelCls } },
          ],
          $: { class: "summary-row" },
        },
      ],
      $: { class: "summary" },
    },
    { button: "登録する ✓",
      $: {
        class: "btn btn-primary",
        value: "confirm",
        onclick: ()=> {
          clock.submitPlan({ dripper: doneConfirmResult$, value: $plan() === "pro" ? "done-pro" : "done-free" });
        }
      }
    },
  ],
  $: { class: "step-inner" },
}));

const doneCard = (title: string, sub: JSHTMLNodeSource) =>
  ({
    fieldset: [
      { legend: [
        { div: title, $: { class: "done-title" } }          
      ] 
      },
      { div: sub,   $: { class: "done-sub" } },
      { button: "↺ 最初から", $: { class: "btn btn-restart", value: "restart", onclick: restart } },
    ],
    $: { class: "step-inner" },
  });

const doneFreeCard    = doneCard("✅ 登録完了！",           [$email,`に確認メールを送りました。`]);
const doneProCard     = doneCard("🚀 Pro へようこそ！",     "API キーを発行中…");
const doneApiReadyCard = doneCard("🔑 API キー発行完了！", "ダッシュボードからご確認ください。");

const stepCardForm = {
  form: [
    emailCard({ emailInput$ }),
    planCard({ planSelect$, $freePlanClass, $proPlanClass }),
    confirmCard({ $email, $planLabel, $planLabelCls }),
    doneFreeCard,
    doneProCard,
    doneApiReadyCard
  ],
  $: {
    onsubmit: (e: Event) => {
      e.preventDefault();
    }
  }
}

document.documentElement.querySelector("head").append(jshtml(
{ style: [
  `form>fieldset { display: none !important; }
   form>fieldset:nth-child(`, remap<Phase,number>((p)=>phaseToStep[p]+1)($phase), `) { display: flex !important; }`
  ],
  $: {
    type: "text/css"
  }
}
));

// ─── Restart ───────────────────────────────────────────────────────────

let wizardHandle: ReturnType<typeof executeByElement> | null = null;
let wizardFxContainer: HTMLElement | null = null;

async function restart() {
  if (wizardHandle) {
    wizardHandle.cancel();
    await wizardHandle.done.catch(() => {});
    wizardHandle = null;
  }
  // restart$ 一本で全状態をリセット
  await clock.submitPlan({ dripper: restart$, value: undefined });

  if (wizardFxContainer) {
    const old = wizardFxContainer.querySelector("fx-effect");
    if (old) wizardFxContainer.removeChild(old);
    await new Promise<void>((r) => setTimeout(r, 30));
    wizardFxContainer.appendChild(WizardEffect(fxContext) as FxEffectElement);
  }
};

// ─── 8. MutationObserver ─────────────────────────────────────────────────

const mo = new MutationObserver((records) => {
  records
    .flatMap((r) => [...r.addedNodes])
    .flatMap((n): Element[] =>
      n instanceof Element
        ? n.tagName.toLowerCase() === "fx-effect"
          ? [n]
          : [...n.querySelectorAll("fx-effect")]
        : []
    )
    .forEach((el) => {
      wizardHandle = executeByElement(el as FxEffectElement, fxContext);
    });
});
mo.observe(document.body, { subtree: true, childList: true });

// ─── 9. Commit ログ ──────────────────────────────────────────────────────

const commitLogEl = document.createElement("ul");
commitLogEl.className = "commit-log";

clock.observeTick((tick) => {
  const li = document.createElement("li");
  li.className = "commit-entry";
  li.innerHTML =
    `<span class="tick-id">#${tick.tick_index}</span>` +
    `<span class="commit-msg">${tick.effects_summary.size} props</span>`;
  commitLogEl.appendChild(li);
  if (commitLogEl.children.length > 60) commitLogEl.firstChild?.remove();
});

// ─── 10. Score パネル ────────────────────────────────────────────────────

type TP = { cls: string; text: string };
const T = {
  tag:  (t: string): TP   => ({ cls: "tag",       text: t }),
  attr: (t: string): TP   => ({ cls: "attr-name", text: ` ${t}` }),
  val:  (t: string): TP[] => [
    { cls: "punct", text: '="' }, { cls: "attr-val", text: t }, { cls: "punct", text: '"' },
  ],
  p:    (t: string): TP   => ({ cls: "punct",   text: t }),
  cmt:  (t: string): TP   => ({ cls: "comment", text: `<!-- ${t} -->` }),
};
const SL = (indent: number, ...parts: (TP | TP[])[]) =>
  jshtml({
    div: parts.flat().map((p) => jshtml({ span: p.text, $: { class: `token ${p.cls}` } })),
    $: { class: "score-line", style: { paddingLeft: `${indent * 1.5}em` } },
  });

const buildScorePanel = () =>
  jshtml({
    pre: [
      SL(0, T.cmt("templates（委譲先）")),
      SL(0, T.tag("<template"), T.attr("id"), ...T.val("step-email"), T.p(">")),
      SL(1, T.tag("<fx-wait"),   T.attr("until"), ...T.val("$waitEmailNext"), T.p(" />")),
      SL(1, T.tag("<fx-return"), T.attr("value"), ...T.val("$email"),         T.p(" />")),
      SL(0, T.tag("</template>")),
      SL(0, T.p("")),
      SL(0, T.cmt("main sequence — fx-call がフェーズを進める")),
      SL(0, T.tag("<fx-sequence"), T.attr("id"), ...T.val("wizard-seq"), T.p(">")),
      SL(1, T.tag("<fx-yield"), T.attr("for"), ...T.val("#step-email"),   T.attr("id"), ...T.val("yield-email"),   T.p(" />")),
      SL(1, T.tag("<fx-call"),  T.attr("action"), ...T.val("goPlan"),     T.p(" />")),
      SL(1, T.tag("<fx-yield"), T.attr("for"), ...T.val("#step-plan"),    T.attr("id"), ...T.val("yield-plan"),    T.p(" />")),
      SL(1, T.tag("<fx-call"),  T.attr("action"), ...T.val("goConfirm"),  T.p(" />")),
      SL(1, T.tag("<fx-yield"), T.attr("for"), ...T.val("#step-confirm"), T.attr("id"), ...T.val("yield-confirm"), T.p(" />")),
      SL(1, T.tag("<fx-switch"), T.attr("by"), ...T.val("#yield-confirm"), T.p(">")),
      SL(2, T.tag("<fx-sequence"), T.attr("slot"), ...T.val("free"), T.p(">")),
      SL(3, T.tag("<fx-call"), T.attr("action"), ...T.val("goFree"), T.p(" />")),
      SL(2, T.tag("</fx-sequence>")),
      SL(2, T.tag("<fx-sequence"), T.attr("slot"), ...T.val("pro"), T.p(">")),
      SL(3, T.tag("<fx-call"), T.attr("action"), ...T.val("goPro"),      T.p(" />")),
      SL(3, T.tag("<fx-wait"), T.attr("timer"),  ...T.val("1500"),        T.p(" />")),
      SL(3, T.tag("<fx-call"), T.attr("action"), ...T.val("goApiReady"), T.p(" />")),
      SL(2, T.tag("</fx-sequence>")),
      SL(1, T.tag("</fx-switch>")),
      SL(0, T.tag("</fx-sequence>")),
    ],
    $: { class: "score-code" },
  });

// ─── 11. Styles ──────────────────────────────────────────────────────────

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;600&display=swap');

  :root {
    --bg:        #0d0f12;  --bg-panel:  #13161b;  --bg-inset:  #0a0c0f;
    --border:    #222630;  --text:      #c8cdd8;  --text-dim:  #4a5068;
    --text-mid:  #7a83a0;  --green:     #34d399;  --amber:     #fbbf24;
    --blue:      #60a5fa;  --purple:    #a78bfa;
    --mono: 'IBM Plex Mono', monospace;
    --sans: 'IBM Plex Sans', sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.6; min-height: 100vh; }

  .showcase { display: grid; grid-template-rows: auto 1fr auto; min-height: 100vh; }
  .showcase-header { padding: 1.75rem 2.5rem; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 1.5rem; }
  .logo { font-family: var(--mono); font-size: 1.4rem; font-weight: 600; color: #fff; letter-spacing: -0.02em; }
  .logo em { color: var(--green); font-style: normal; }
  .tagline { font-family: var(--mono); font-size: 0.72rem; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
  .header-badge { margin-left: auto; font-family: var(--mono); font-size: 0.68rem; color: var(--text-dim); border: 1px solid var(--border); padding: 0.2em 0.65em; border-radius: 2px; }

  .showcase-main { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--border); }
  .panel { padding: 2rem 2.5rem; display: flex; flex-direction: column; gap: 1.25rem; }
  .panel-score { border-right: 1px solid var(--border); }
  .panel-label { font-family: var(--mono); font-size: 0.63rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-dim); }
  .panel-desc  { font-size: 0.8rem; color: var(--text-mid); line-height: 1.7; }

  .score-code { background: var(--bg-inset); border: 1px solid var(--border); border-radius: 4px; padding: 1.25rem 1.5rem; font-family: var(--mono); font-size: 0.72rem; line-height: 2.1; overflow: auto; flex: 1; }
  .score-line { display: block; white-space: pre; }
  .token.tag       { color: #7dd3fc; }
  .token.attr-name { color: #a5f3fc; }
  .token.attr-val  { color: #86efac; }
  .token.punct     { color: var(--text-dim); }
  .token.comment   { color: var(--text-dim); font-style: italic; }

  .stepper { display: flex; align-items: center; }
  .step-item { display: flex; align-items: center; gap: 0.4rem; font-family: var(--mono); font-size: 0.65rem; color: var(--text-dim); transition: color 0.2s; }
  .step-item.active { color: var(--amber); }
  .step-item.done   { color: var(--green); }
  .step-num { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid currentColor; display: flex; align-items: center; justify-content: center; font-size: 0.58rem; flex-shrink: 0; }
  .step-item.active .step-num { background: rgba(251,191,36,0.1); }
  .step-item.done   .step-num { background: rgba(52,211,153,0.1); }
  .step-connector { flex: 1; height: 1px; background: var(--border); margin: 0 0.5rem; min-width: 0.75rem; max-width: 2.5rem; }

form {
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1.5rem;
  min-height: 160px;
}

fieldset {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

legend {
  font-family: var(--mono);
  font-size: 0.67rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0;
  margin-bottom: 0.5rem;
  float: left;
  width: 100%;
}

/* done カードの legend は icon + title を横並びにする */
legend > .done-icon {
  font-size: 1.6rem;
  line-height: 1;
}

legend > .done-title {
  font-family: var(--mono);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--green);
  margin-top: 0.3rem;
}

  .field { display: flex; flex-direction: column; gap: 0.4rem; }
  .field label { font-family: var(--mono); font-size: 0.65rem; color: var(--text-mid); }
  .field input[type="email"] { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 3px; color: var(--text); font-family: var(--mono); font-size: 0.8rem; padding: 0.5em 0.8em; outline: none; width: 100%; transition: border-color 0.15s; }
  .field input[type="email"]:focus { border-color: var(--blue); }

  .plan-cards { display: flex; gap: 0.75rem; }
  .plan-card { flex: 1; background: var(--bg-panel); border: 1.5px solid var(--border); border-radius: 4px; padding: 0.9rem 1rem; cursor: pointer; transition: border-color 0.15s, background 0.15s; font-family: var(--mono); user-select: none; }
  .plan-card.selected { border-color: var(--green); background: rgba(52,211,153,0.06); }
  .plan-name  { font-size: 0.82rem; font-weight: 600; color: var(--text); margin-bottom: 0.2rem; }
  .plan-price { font-size: 0.67rem; color: var(--text-dim); }

  .summary { display: flex; flex-direction: column; gap: 0.45rem; }
  .summary-row { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 0.72rem; }
  .summary-key { color: var(--text-dim); }
  .summary-val { color: var(--text); }
  .summary-val.plan-pro  { color: var(--purple); }
  .summary-val.plan-free { color: var(--blue); }

  .done-sub   { font-size: 0.78rem; color: var(--text-mid); }

  .btn { font-family: var(--mono); font-size: 0.74rem; padding: 0.42em 1.1em; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-panel); color: var(--text); cursor: pointer; align-self: flex-start; transition: border-color 0.12s, color 0.12s, background 0.12s; }
  .btn:hover        { border-color: var(--text-mid); }
  .btn-primary      { border-color: var(--green); color: var(--green); }
  .btn-primary:hover{ background: rgba(52,211,153,0.08); }
  .btn-restart      { border-color: var(--text-dim); color: var(--text-dim); }
  .btn-restart:hover{ border-color: var(--text); color: var(--text); }

  fx-effect, fx-sequence, fx-yield, fx-wait, fx-call, fx-switch {
    display: block; font-family: var(--mono); font-size: 0.7rem;
    padding: 0.3rem 0.7rem 0.3rem 0.8rem;
    border-left: 2.5px solid var(--border); border-radius: 0 3px 3px 0;
    background: var(--bg-inset); color: var(--text-dim); margin: 2px 0;
    transition: border-color 0.2s, background 0.2s, color 0.2s;
  }
  fx-sequence { background: transparent; border-left-color: transparent; }

  fx-effect:state(running), fx-yield:state(running), fx-wait:state(running), fx-call:state(running), fx-switch:state(running)
    { border-left-color: var(--amber); background: rgba(251,191,36,0.04); color: var(--text); }
  fx-yield:state(paused), fx-wait:state(paused)
    { border-left-color: var(--blue); background: rgba(96,165,250,0.05); color: var(--blue); animation: pulse 1.6s ease-in-out infinite; }
  fx-effect:state(completed), fx-yield:state(completed), fx-wait:state(completed), fx-call:state(completed), fx-switch:state(completed)
    { border-left-color: var(--green); background: rgba(52,211,153,0.04); color: var(--text-mid); }

  fx-effect.is-running, fx-yield.is-running, fx-wait.is-running, fx-call.is-running, fx-switch.is-running
    { border-left-color: var(--amber); background: rgba(251,191,36,0.04); color: var(--text); }
  fx-yield.is-paused, fx-wait.is-paused
    { border-left-color: var(--blue); background: rgba(96,165,250,0.05); color: var(--blue); animation: pulse 1.6s ease-in-out infinite; }
  fx-effect.is-completed, fx-yield.is-completed, fx-wait.is-completed, fx-call.is-completed, fx-switch.is-completed
    { border-left-color: var(--green); background: rgba(52,211,153,0.04); color: var(--text-mid); }

  @keyframes pulse {
    0%, 100% { box-shadow: inset 0 0 0 1px rgba(96,165,250,0.08); }
    50%       { box-shadow: inset 0 0 0 1px rgba(96,165,250,0.3); }
  }

  .score-legend { display: flex; gap: 1.25rem; flex-wrap: wrap; }
  .legend-item  { display: flex; align-items: center; gap: 0.4rem; font-family: var(--mono); font-size: 0.67rem; color: var(--text-mid); }
  .legend-dot   { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

  .showcase-footer { padding: 1.5rem 2.5rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.75rem; }
  .commit-log { list-style: none; display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .commit-entry { display: inline-flex; align-items: center; gap: 0.5rem; font-family: var(--mono); font-size: 0.67rem; padding: 0.18em 0.6em; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-panel); animation: slide-in 0.15s ease; }
  @keyframes slide-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
  .tick-id    { color: var(--text-dim); }
  .commit-msg { color: var(--green); }

  @media (max-width: 860px) {
    .showcase-main { grid-template-columns: 1fr; }
    .panel-score { border-right: none; border-bottom: 1px solid var(--border); }
  }
`;

// ─── 12. Layout & Mount ──────────────────────────────────────────────────

document.head.appendChild(
  Object.assign(document.createElement("style"), { textContent: STYLES })
);
document.title = "blooky showcase / wizard";

const wizardFxEl = WizardEffect(fxContext) as FxEffectElement;

const performancePanelEl = jshtml({
  section: [
    { div: "The Performance", $: { class: "panel-label" } },
    { p: "fx-yield が各 template を順に実行し、fx-call がフェーズを進める。UI は $phase から派生した宣言的ツリー。", $: { class: "panel-desc" } },
    {
      div: [
        stepperItem("1", "メール",  ["email"]),
        { div: "", $: { class: "step-connector" } },
        stepperItem("2", "プラン",  ["plan"]),
        { div: "", $: { class: "step-connector" } },
        stepperItem("3", "確認",    ["confirm"]),
        { div: "", $: { class: "step-connector" } },
        stepperItem("4", "完了",    ["done-free", "done-pro", "api-ready"]),
      ],
      $: { class: "stepper" },
    },
    // ステップカードは $phase が切り替える
    { div: stepCardForm, $: { class: "step-card" } },
    wizardFxEl,
  ],
  $: { class: "panel panel-performance" },
}) as HTMLElement;

wizardFxContainer = performancePanelEl;

const app = jshtml({
  div: [
    {
      header: [
        { div: [{ em: "bloo" }, "ky"], $: { class: "logo" } },
        { span: "execution as observable facts", $: { class: "tagline" } },
        { span: "showcase / wizard", $: { class: "header-badge" } },
      ],
      $: { class: "showcase-header" },
    },
    {
      main: [
        {
          section: [
            { div: "The Score", $: { class: "panel-label" } },
            { p: "fx-yield がテンプレートに委譲。fx-call がフェーズを進め、UI は $phase から自動的に更新される。", $: { class: "panel-desc" } },
            buildScorePanel(),
            {
              div: [
                { div: [{ div: "", $: { class: "legend-dot", style: { background: "var(--amber)" } } }, { span: "running" }],   $: { class: "legend-item" } },
                { div: [{ div: "", $: { class: "legend-dot", style: { background: "var(--blue)" } } },  { span: "suspended" }], $: { class: "legend-item" } },
                { div: [{ div: "", $: { class: "legend-dot", style: { background: "var(--green)" } } }, { span: "completed" }], $: { class: "legend-item" } },
              ],
              $: { class: "score-legend" },
            },
          ],
          $: { class: "panel panel-score" },
        },
        performancePanelEl,
      ],
      $: { class: "showcase-main" },
    },
    {
      footer: [
        { div: "Atomic Commits", $: { class: "panel-label" } },
        commitLogEl,
      ],
      $: { class: "showcase-footer" },
    },
  ],
  $: { class: "showcase" },
});

document.body.appendChild(app);

