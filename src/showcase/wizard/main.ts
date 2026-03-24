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

const restart$ = stream<void>();

// restart$ はフェーズを "email" に戻す
const finishPhaseAction$ = stream<Event>();
const endOfPhase$ = map<Event,Phase>((e)=>(e.target as HTMLButtonElement).value as Phase)(finishPhaseAction$);
const doneConfirmResult$ = stream<"done-free"|"done-pro">();
const $phase = hold<Phase>("email")(merge<Phase>([
  map<Phase,Phase>(getNextPhase)(merge([endOfPhase$,doneConfirmResult$])),
  map((): Phase => "email")(restart$),
]))

// フォーム値
const emailInput$ = stream<Event>();
const $email = hold("")(merge([
  map<Event, string>((e) => (e.target as HTMLInputElement).value)(emailInput$),
  map((): string => "")(restart$),
]));

const planSelect$ = stream<MouseEvent>();
const $plan = hold("free")(merge([
  map<Event,string>((e)=> (e.target as HTMLElement).closest("*[id]")!.getAttribute("data-plan") ?? "free")(planSelect$),
  map((): string => "free")(restart$),
]));


function getNextPhase (current: Phase) : Phase {
  switch(current) {
    case "email": return "plan";
    case "plan": return "confirm";
    case "confirm": return $plan() === "pro" ? "done-pro" : "done-free";
    case "done-pro": return "api-ready";
    case "done-free":
    case "api-ready": return "email";
  }
  return "email";
}


const $emailEnd = remap((p)=> p !== "email")($phase);
const $planEnd = remap((p)=> p !== "plan")($phase);
const $confirmEnd = remap((p)=> p !== "confirm")($phase);

const log = (msg: unknown) => console.log("[wizard]", msg);

// ─── 3. Context ───────────────────────────────────────────────────────────

const fxContext = {
  $email, $plan, doneConfirmResult$,
  emailInput$, planSelect$,
  $emailEnd, $planEnd, $confirmEnd,
  String, log
};

// ─── 4. Score ─────────────────────────────────────────────────────────────
 
const WizardEffect = prime(({
  $email, $plan, doneConfirmResult$,
  $emailEnd, $planEnd, $confirmEnd,
  String,
  log
}: typeof fxContext) => ({
  "fx-effect": [
    {
      "fx-sequence": [
        { "fx-wait": jshtml.$({ until: $emailEnd }) },
        { "fx-wait": jshtml.$({ until: $planEnd }) },
        { "fx-wait": jshtml.$({ until: $confirmEnd }) },
        { "fx-call": jshtml.$({ action: log, input: $plan }) },
        {
          "fx-switch": [
            { "fx-call": jshtml.$({ slot: "free", action: "log", input: $plan }) },
            {
              "fx-sequence": [
                { "fx-call": jshtml.$({ action: "log", input: "call-pro" }) },
                { "fx-wait": jshtml.$({ timer: 1500,   id: "wait-api"     }) },
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
const $planLabel = remap((p: string) => p === "pro" ? "Pro ¥2,980/月" : "Free  ¥0/月")($plan);
const $planLabelCls = remap((p: string) => "summary-val " + (p === "pro" ? "plan-pro" : "plan-free"))($plan);

// ステップカードの内容（$phase から派生）



const nextStepBtn = prime(({
  $value,
  action$
}:{
  $value: Prop<Phase>
  action$: Dripper<Event>
})=>({
  button: "Next →", 
  $: {
    type : "button",
    class: "btn btn-primary",
    value: $value,
    onclick: (e: Event) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const formElement = btn.form;
      if(formElement && !formElement.checkValidity()) {
        formElement.reportValidity();
      } else {
        const next = getNextPhase(btn.value as Phase);
        clock.submitPlan([action$,e]).then(()=>{
          [...formElement.children].filter((n)=>n.nodeName === "FIELDSET").forEach((n)=>{
            (n as HTMLFieldSetElement).style.display = n.className === next ? "flex" : "none";
          })
        })
      }
    }
  }
}));

const emailCard = prime(({emailInput$}:{emailInput$:Dripper<Event>})=>({
  fieldset: [
    { legend: "Step 1 / メールアドレス", $: { class: "step-title" } },
    {
      div: [
        { label: "email", $: { for: "email-inp" } },
        { input: jshtml.$({ type: "email", id: "email-inp", required: true, placeholder: "you@example.com", oninput: emailInput$ }) },
      ],
      $: { class: "field" },
    },
    nextStepBtn({ $value: $phase, action$: finishPhaseAction$ }),
  ],
  $: { class: "email" },
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
    nextStepBtn({ $value: $phase, action$: finishPhaseAction$ }),
  ],
  $: { class: "plan" },
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
    nextStepBtn({ $value: $phase, action$: finishPhaseAction$ }),
  ],
  $: { class: "confirm" },
}));

const doneCard = prime(({ $doneTitle, $doneSubTitle }:{
  $doneTitle: Prop<JSHTMLNodeSource>
  $doneSubTitle: Prop<JSHTMLNodeSource>
})=>({
  fieldset: [
    { legend: [
      { div: $doneTitle, $: { class: "done-title" } }          
    ] 
    },
    { div: $doneSubTitle,   $: { class: "done-sub" } },
    { button: "↺ 最初から", $: { class: "btn btn-restart", value: "restart", onclick: restart } },
  ],
  $: { class: "step-inner" },
}));

const $doneTitle = remap<Phase,string>((phase)=>{
  if(phase === "done-free")
    return "✅ 登録完了！";
  if(phase === "done-pro")
    return "🚀 Pro へようこそ！";
  return "🔑 API キー発行完了！";
})($phase);

const $doneSubTitle = remap<Phase,JSHTMLNodeSource>((phase)=>{
  if(phase === "done-free")
    return [$email,`に確認メールを送りました。`]
  if(phase === "done-pro")
    return "API キーを発行中…";
  return "ダッシュボードからご確認ください。";
})($phase);

const stepCardForm = {
  form: [
    emailCard({ emailInput$ }),
    planCard({ planSelect$, $freePlanClass, $proPlanClass }),
    confirmCard({ $email, $planLabel, $planLabelCls }),
    doneCard({ $doneTitle, $doneSubTitle })
  ].map((element, i)=>{
    (element as HTMLElement).style.display = i ? "none" : "flex";
    return element;
  }),
  $: {
    onsubmit: (e: Event) => {
      e.preventDefault();
    }
  }
}


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
  await clock.submitPlan([restart$,undefined]);

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

const styleElement = document.createElement("style");
fetch("/blooky-showcase-basic.css")
  .then((response)=>response.text())
  .then((textContent)=>styleElement.textContent = textContent);

// ─── 12. Layout & Mount ──────────────────────────────────────────────────

document.title = "blooky showcase / wizard";
document.head.append(styleElement);

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

