/**
 * blooky showcase — JRPG ターン制バトルデモ
 *
 * FRP設計原則：一つの出来事は一つのdripperから流れる
 *
 * restart$ が全状態リセットの唯一のイベント源。
 * $playerDefeated と $enemyDefeated は共に restart$ から派生するため、
 * lift($battleActive) は単一 DripPlan 内で更新され CommitConflict が発生しない。
 *
 * sub() は共通の lift 派生先を持たない独立した stream への同時送信にのみ使用する。
 *
 * Score の構造:
 *   fx-sequence
 *     └─ fx-race
 *          ├─ fx-wait until=$enemyDefeated   ← 勝利条件
 *          ├─ fx-wait until=$playerDefeated  ← 敗北条件
 *          └─ fx-loop while=$battleActive
 *               ├─ fx-call  resetTurn
 *               ├─ fx-yield for="#action-menu"    ← プレイヤー入力を委譲
 *               ├─ fx-switch by="#yield-action"
 *               │    ├─ attack → fx-call doAttack
 *               │    ├─ magic  → fx-sequence( fx-call doMagic + fx-wait timer=600 )
 *               │    └─ item   → fx-sequence( fx-yield "#item-select" + fx-call doItem )
 *               ├─ fx-wait timer=400
 *               └─ fx-call  doEnemyTurn
 *     └─ fx-if test=$enemyDefeated
 *          ├─ then → fx-call onVictory
 *          └─ else → fx-call onDefeat
 */

import { fxdom, EffectElementTagNameMap, executeByElement } from "../../blooky-devtools";
import { stream, accum, merge, map, remap, hold } from "../../blooky-fp";
import { DripPlan, Stream } from "../../blooky-fp-types";
import { createFV } from "../../blooky-fv";
import { FxEffectElement } from "../../blooky-fxdom";
import { clock } from "../../runtime/clock";

const { prime, jshtml } = createFV(clock);
fxdom.defineEffectElements(EffectElementTagNameMap);

// ── Constants ─────────────────────────────────────────────────────────────

const PLAYER_MAX_HP  = 100;
const PLAYER_MAX_MP  = 40;
const ENEMY_MAX_HP   = 80;
const MAGIC_MP_COST  = 12;
const INIT_POTION    = 2;
const INIT_ETHER     = 1;

// ── StatEv: デルタ or リセット ────────────────────────────────────────────
//
// HP/MP ストリームに「差分更新」と「絶対値リセット」の両方を流すための型。
// restart$ から r(MAX) を流すことで、単一 DripPlan 内で全 HP/MP をリセットする。

type StatEv = { t: "d"; v: number } | { t: "r"; v: number };
const d = (v: number): StatEv => ({ t: "d", v });
const r = (v: number): StatEv => ({ t: "r", v });
const applyStatEv = (min: number, max: number) =>
  (current: number, ev: StatEv): number =>
    ev.t === "r" ? ev.v : Math.max(min, Math.min(max, current + ev.v));

// ── FRP Core ──────────────────────────────────────────────────────────────

// 全状態リセットの唯一のイベント源
const restart$ = stream<void>();

// ── HP / MP ───────────────────────────────────────────────────────────────

const playerDmg$  = stream<number>();
const playerHeal$ = stream<number>();
const $playerHP = accum(
  applyStatEv(0, PLAYER_MAX_HP),
  PLAYER_MAX_HP
)(merge([
  map((dmg: number): StatEv => d(-dmg))(playerDmg$),
  map((heal: number): StatEv => d(heal))(playerHeal$),
  map((): StatEv => r(PLAYER_MAX_HP))(restart$),
]));

const enemyDmg$ = stream<number>();
const $enemyHP = accum(
  applyStatEv(0, ENEMY_MAX_HP),
  ENEMY_MAX_HP
)(merge([
  map((dmg: number): StatEv => d(-dmg))(enemyDmg$),
  map((): StatEv => r(ENEMY_MAX_HP))(restart$),
]));

const mpSpend$ = stream<number>();
const mpHeal$  = stream<number>();
const $playerMP = accum(
  applyStatEv(0, PLAYER_MAX_MP),
  PLAYER_MAX_MP
)(merge([
  map((mp: number): StatEv => d(-mp))(mpSpend$),
  map((mp: number): StatEv => d(mp))(mpHeal$),
  map((): StatEv => r(PLAYER_MAX_MP))(restart$),
]));

// ── 勝敗条件 ──────────────────────────────────────────────────────────────
//
// $playerDefeated・$enemyDefeated はともに restart$ から派生する。
// lift($battleActive) は restart$ の単一 DripPlan 内で両方の更新を受け取るため
// CommitConflict が発生しない。

const $playerDefeated = remap((hp: number) => hp <= 0)($playerHP);
const $enemyDefeated  = remap((hp: number) => hp <= 0)($enemyHP);
const $battleActive   = remap((v)=>!v)($enemyDefeated);//lift(([pd, ed]: boolean[]) => !pd && !ed)([$playerDefeated, $enemyDefeated]);

// ── 行動選択 ──────────────────────────────────────────────────────────────

const actionChoice$ = stream<string>();
const actionReset$  = stream<void>();
const $actionChosen = hold(false)(merge([
  map((): boolean => true)(actionChoice$),
  map((): boolean => false)(actionReset$),
  map((): boolean => false)(restart$),
]));
const $selectedAction = hold("attack")(actionChoice$);

const itemChoice$ = stream<string>();
const itemReset$  = stream<void>();
const $itemChosen = hold(false)(merge([
  map((): boolean => true)(itemChoice$),
  map((): boolean => false)(itemReset$),
  map((): boolean => false)(restart$),
]));
const $selectedItem = hold("")(itemChoice$);

// ── アイテム在庫 ──────────────────────────────────────────────────────────

const potionUse$ = stream<number>(); // 使用後の残数を流す
const $potionCount = hold(INIT_POTION)(merge([
  potionUse$,
  map((): number => INIT_POTION)(restart$),
]));

const etherUse$ = stream<number>();
const $etherCount = hold(INIT_ETHER)(merge([
  etherUse$,
  map((): number => INIT_ETHER)(restart$),
]));

// ── フェーズ / バトル結果 ─────────────────────────────────────────────────

const phase$ = stream<string>();
const $phase = hold("waiting")(merge([
  phase$,
  map((): string => "waiting")(restart$),
]));

type BattleResult = "victory" | "defeat" | null;
const result$ = stream<BattleResult>();
const $result = hold<BattleResult>(null)(merge([
  result$,
  map((): BattleResult => null)(restart$),
]));

// ── ターン番号 ────────────────────────────────────────────────────────────

type TurnEv = "inc" | "reset";
const turnInc$ = stream<void>();
const $turn = accum(
  (n: number, ev: TurnEv) => ev === "reset" ? 0 : n + 1,
  0
)(merge([
  map((): TurnEv => "inc")(turnInc$),
  map((): TurnEv => "reset")(restart$),
]));

// ── バトルログ ────────────────────────────────────────────────────────────

type LogEv = string | null; // null = クリア
const logEntry$ = stream<string>();
const $battleLog = accum(
  (log: string[], ev: LogEv) => ev === null ? [] : [...log.slice(-4), ev],
  [] as string[]
)(merge<LogEv>([
  logEntry$ as Stream<LogEv>,
  map((): LogEv => null)(restart$),
]));

// ── HP バー表示用 ─────────────────────────────────────────────────────────

const pct   = (max: number) => (hp: number) => `${(hp / max * 100).toFixed(0)}%`;
const color = (max: number) => (hp: number) =>
  hp > max * 0.5 ? "#34d399" : hp > max * 0.25 ? "#fbbf24" : "#f87171";

const $playerHPPct   = remap(pct(PLAYER_MAX_HP))($playerHP);
const $enemyHPPct    = remap(pct(ENEMY_MAX_HP))($enemyHP);
const $playerMPPct   = remap(pct(PLAYER_MAX_MP))($playerMP);
const $playerHPColor = remap(color(PLAYER_MAX_HP))($playerHP);
const $enemyHPColor  = remap(color(ENEMY_MAX_HP))($enemyHP);

// ── Actions ───────────────────────────────────────────────────────────────
//
// sub() は互いに共通の lift 派生先を持たない独立した stream への
// 同一 Tick 送信に限り安全に使用できる。

const sub = (...plans: DripPlan<any>[]) =>
  Promise.all(plans.map((p) => clock.submitPlan(p)));

// ターン開始時のリセット
const resetTurn = async () => {
  await sub(
    [actionReset$,undefined],
    [itemReset$,undefined],
    [phase$,"waiting"],
    [turnInc$,undefined],
  );
};

const doAttack = async () => {
  const dmg = Math.floor(Math.random() * 15) + 8; // 8–22
  await sub(
    [enemyDmg$,dmg],
    [logEntry$,`⚔️  攻撃！${dmg} ダメージ！`],
  );
};

const doMagic = async () => {
  if ($playerMP() < MAGIC_MP_COST) {
    await clock.submitPlan([logEntry$,"💧 MP が足りない！"]);
    return;
  }
  const dmg = Math.floor(Math.random() * 20) + 15; // 15–34
  await sub(
    [mpSpend$,MAGIC_MP_COST],
    [enemyDmg$,dmg],
    [logEntry$,`✨ ファイア！${dmg} ダメージ！`],
  );
};

const doItem = async () => {
  const item = $selectedItem();
  const pc   = $potionCount();
  const ec   = $etherCount();
  if (item === "potion" && pc > 0) {
    await sub(
      [playerHeal$,30],
      [potionUse$,pc - 1],
      [logEntry$,"💊 ポーション！HP +30！"],
    );
  } else if (item === "ether" && ec > 0) {
    await sub(
      [mpHeal$,20],
      [etherUse$,ec - 1],
      [logEntry$,"💎 エーテル！MP +20！"],
    );
  } else {
    await clock.submitPlan([logEntry$,"❌ 使えない！"]);
  }
};

const doEnemyTurn = async () => {
  await clock.submitPlan([phase$,"enemy"]);
  const roll = Math.random();
  let dmg: number, msg: string;
  if (roll < 0.4) {
    dmg = Math.floor(Math.random() * 10) + 5;
    msg = `🐉 かみつき！${dmg} ダメージ！`;
  } else if (roll < 0.75) {
    dmg = Math.floor(Math.random() * 14) + 8;
    msg = `🔥 炎のブレス！${dmg} ダメージ！`;
  } else {
    dmg = Math.floor(Math.random() * 18) + 12;
    msg = `💥 テールスマッシュ！${dmg} ダメージ！`;
  }
  await sub(
    [playerDmg$,dmg],
    [logEntry$,msg],
  );
};

const onVictory = async () => {
  await sub(
    [result$,"victory" as BattleResult],
    [logEntry$,"🏆 勝利！ドラゴンを倒した！"],
    [phase$,"result"],
  );
};

const onDefeat = async () => {
  await sub(
    [result$,"defeat" as BattleResult],
    [logEntry$,"💀 敗北…勇者は力尽きた…"],
    [phase$,"result"],
  );
};

// ── Context ───────────────────────────────────────────────────────────────

const fxContext = {
  $actionChosen, $selectedAction,
  $itemChosen,   $selectedItem,
  $playerDefeated, $enemyDefeated, $battleActive,
  resetTurn, doAttack, doMagic, doItem, doEnemyTurn,
  onVictory, onDefeat,
};

// ── Score（fx-effect 宣言） ────────────────────────────────────────────────

const BattleEffect = prime(({
  $actionChosen, $selectedAction,
  $itemChosen,   $selectedItem,
  $playerDefeated, $enemyDefeated, $battleActive,
  resetTurn, doAttack, doMagic, doItem, doEnemyTurn,
  onVictory, onDefeat,
}: typeof fxContext) => ({
  "fx-effect": [

    // ── templates（fx-yield の委譲先） ──────────────────────────────────────
    {
      template: [
        { "fx-wait":   jshtml.$({ until: $actionChosen, id: "t-wait-action" }) },
        { "fx-return": jshtml.$({ value: $selectedAction }) },
      ],
      $: { id: "action-menu" },
    },
    {
      template: [
        { "fx-wait":   jshtml.$({ until: $itemChosen, id: "t-wait-item" }) },
        { "fx-return": jshtml.$({ value: $selectedItem }) },
      ],
      $: { id: "item-select" },
    },

    // ── バトル本体 ─────────────────────────────────────────────────────────
    {
      "fx-sequence": [

        // race: 勝利 / 敗北 / ループの三竦み
        {
          "fx-race": [
            { "fx-wait": jshtml.$({ until: $enemyDefeated,  id: "wait-victory" }) },
            { "fx-wait": jshtml.$({ until: $playerDefeated, id: "wait-defeat"  }) },
            {
              "fx-loop": [
                { "fx-call":  jshtml.$({ action: "resetTurn",  id: "call-reset"   }) },
                { "fx-yield": jshtml.$({ for: "#action-menu",  id: "yield-action" }) },
                {
                  "fx-switch": [
                    {
                      "fx-call": jshtml.$({ action: "doAttack", id: "call-attack", slot: "attack" }),
                    },
                    {
                      "fx-sequence": [
                        { "fx-call": jshtml.$({ action: "doMagic",  id: "call-magic"      }) },
                        { "fx-wait": jshtml.$({ timer: 600,          id: "wait-magic-anim" }) },
                      ],
                      $: { slot: "magic" },
                    },
                    {
                      "fx-sequence": [
                        { "fx-yield": jshtml.$({ for: "#item-select", id: "yield-item" }) },
                        { "fx-call":  jshtml.$({ action: "doItem",    id: "call-item"  }) },
                      ],
                      $: { slot: "item" },
                    },
                  ],
                  $: { by: "#yield-action", id: "switch-action" },
                },
                { "fx-wait": jshtml.$({ timer: 400,              id: "wait-pre-enemy"  }) },
                { "fx-call": jshtml.$({ action: "doEnemyTurn",   id: "call-enemy"      }) },
                { "fx-wait": jshtml.$({ timer: 300,              id: "wait-post-enemy" }) },
              ],
              $: { while: $battleActive, id: "battle-loop" },
            },
          ],
          $: { id: "battle-race" },
        },

        // 勝敗の後処理
        {
          "fx-if": [
            { "fx-call": jshtml.$({ action: "onVictory", id: "call-victory", slot: "then" }) },
            { "fx-call": jshtml.$({ action: "onDefeat",  id: "call-defeat",  slot: "else" }) },
          ],
          $: { test: $enemyDefeated, id: "if-result" },
        },
      ],
      $: { id: "battle-main" },
    },
  ],
  $: { id: "battle-effect" },
}));

// ── Reactive UI helpers ───────────────────────────────────────────────────

const $logNodes = remap(
  (log: string[]) =>
    log.length === 0
      ? [{ div: "— 戦闘開始 —", $: { class: "log-entry log-start" } }]
      : log.map((msg) => ({ div: msg, $: { class: "log-entry" } }))
)($battleLog);

const $resultOverlay = remap(
  (res: BattleResult) =>
    res === null
      ? { div: "", $: { class: "result-overlay hidden" } }
      : {
          div: [
            { div: res === "victory" ? "🏆" : "💀",                          $: { class: "result-icon" } },
            { div: res === "victory" ? "VICTORY" : "DEFEAT",                 $: { class: `result-title ${res}` } },
            { div: res === "victory" ? "ドラゴンを討伐した！" : "勇者は倒れた…", $: { class: "result-sub" } },
            { button: "↺ もう一度", $: { class: "btn btn-restart", id: "btn-restart" } },
          ],
          $: { class: "result-overlay" },
        }
)($result);

const $actionPanelClass = remap(
  (p: string) => "action-panel" + (p === "waiting" ? "" : " hidden")
)($phase);
const $itemPanelClass = remap(
  (p: string) => "item-panel" + (p === "item-select" ? "" : " hidden")
)($phase);
const $statusText = remap((p: string) =>
  p === "enemy"       ? "🐉 ドラゴンのターン…" :
  p === "acting"      ? "…" :
  p === "item-select" ? "アイテムを選べ" : ""
)($phase);

const $playerHPText  = remap((hp: number) => `${hp} / ${PLAYER_MAX_HP}`)($playerHP);
const $enemyHPText   = remap((hp: number) => `${hp} / ${ENEMY_MAX_HP}`)($enemyHP);
const $playerMPText  = remap((mp: number) => `${mp} / ${PLAYER_MAX_MP}`)($playerMP);
const $turnLabel     = remap((n: number) => n > 0 ? `Turn ${n}` : "")($turn);
const $potionLabel   = remap((n: number) => `💊 ポーション ×${n}`)($potionCount);
const $etherLabel    = remap((n: number) => `💎 エーテル  ×${n}`)($etherCount);
const $potionDisabled = remap((n: number) => n === 0 ? "disabled" : null)($potionCount);
const $etherDisabled  = remap((n: number) => n === 0 ? "disabled" : null)($etherCount);

// ── Score パネル ──────────────────────────────────────────────────────────

type TP = { cls: string; text: string };
const T = {
  tag:  (t: string): TP   => ({ cls: "tag",       text: t }),
  attr: (t: string): TP   => ({ cls: "attr-name", text: ` ${t}` }),
  val:  (t: string): TP[] => [
    { cls: "punct", text: '="' }, { cls: "attr-val", text: t }, { cls: "punct", text: '"' },
  ],
  p:    (t: string): TP   => ({ cls: "punct",   text: t }),
  cmt:  (t: string): TP   => ({ cls: "comment", text: `<!-- ${t} -->` }),
  _: { cls: "punct", text: "" } as TP,
};
const SL = (indent: number, ...parts: (TP | TP[])[]) =>
  jshtml({
    div: parts.flat().map((p) => jshtml({ span: p.text, $: { class: `token ${p.cls}` } })),
    $: { class: "score-line", style: { paddingLeft: `${indent * 1.15}em` } },
  });

const buildScorePanel = () =>
  jshtml({
    pre: [
      SL(0, T.cmt("templates（委譲先）")),
      SL(0, T.tag("<template"), T.attr("id"), ...T.val("action-menu"), T.p(">")),
      SL(1, T.tag("<fx-wait"),   T.attr("until"), ...T.val("$actionChosen"),   T.p(" />")),
      SL(1, T.tag("<fx-return"), T.attr("value"), ...T.val("$selectedAction"), T.p(" />")),
      SL(0, T.tag("</template>")),
      SL(0, T._),
      SL(0, T.cmt("race: 3 つのゴールが競合")),
      SL(0, T.tag("<fx-race"), T.attr("id"), ...T.val("battle-race"), T.p(">")),
      SL(1, T.tag("<fx-wait"),  T.attr("until"), ...T.val("$enemyDefeated"),  T.p(" />")),
      SL(1, T.tag("<fx-wait"),  T.attr("until"), ...T.val("$playerDefeated"), T.p(" />")),
      SL(1, T.tag("<fx-loop"),  T.attr("while"), ...T.val("$battleActive"),   T.p(">")),
      SL(2, T.tag("<fx-call"),   T.attr("action"), ...T.val("resetTurn"),    T.p(" />")),
      SL(2, T.tag("<fx-yield"),  T.attr("for"),    ...T.val("#action-menu"), T.attr("id"), ...T.val("yield-action"), T.p(" />")),
      SL(2, T.tag("<fx-switch"), T.attr("by"),     ...T.val("#yield-action"), T.p(">")),
      SL(3, T.tag("<fx-call"),  T.attr("action"), ...T.val("doAttack"),  T.attr("slot"), ...T.val("attack"), T.p(" />")),
      SL(3, T.tag("<fx-sequence"), T.attr("slot"), ...T.val("magic"),    T.p(">")),
      SL(4, T.tag("<fx-call"),  T.attr("action"), ...T.val("doMagic"),   T.p(" />")),
      SL(4, T.tag("<fx-wait"),  T.attr("timer"),  ...T.val("600"),       T.p(" />")),
      SL(3, T.tag("</fx-sequence>")),
      SL(3, T.tag("<fx-sequence"), T.attr("slot"), ...T.val("item"),     T.p(">")),
      SL(4, T.tag("<fx-yield"), T.attr("for"),    ...T.val("#item-select"), T.p(" />")),
      SL(4, T.tag("<fx-call"),  T.attr("action"), ...T.val("doItem"),    T.p(" />")),
      SL(3, T.tag("</fx-sequence>")),
      SL(2, T.tag("</fx-switch>")),
      SL(2, T.tag("<fx-wait"),  T.attr("timer"),  ...T.val("400"),       T.p(" />")),
      SL(2, T.tag("<fx-call"),  T.attr("action"), ...T.val("doEnemyTurn"), T.p(" />")),
      SL(1, T.tag("</fx-loop>")),
      SL(0, T.tag("</fx-race>")),
      SL(0, T._),
      SL(0, T.cmt("result dispatch")),
      SL(0, T.tag("<fx-if"), T.attr("test"), ...T.val("$enemyDefeated"), T.p(">")),
      SL(1, T.tag("<fx-call"), T.attr("action"), ...T.val("onVictory"), T.attr("slot"), ...T.val("then"), T.p(" />")),
      SL(1, T.tag("<fx-call"), T.attr("action"), ...T.val("onDefeat"),  T.attr("slot"), ...T.val("else"), T.p(" />")),
      SL(0, T.tag("</fx-if>")),
    ],
    $: { class: "score-code" },
  });

// ── CSS ───────────────────────────────────────────────────────────────────


const styleElement = document.createElement("style");
fetch("/blooky-showcase-basic.css")
  .then((response)=>response.text())
  .then((textContent)=>styleElement.textContent = textContent);


// ── Commit log ────────────────────────────────────────────────────────────

const commitLogEl = document.createElement("ul");
commitLogEl.className = "commit-log";

clock.observeTick((tick) => {
  const li = document.createElement("li");
  li.className = "commit-entry";
  li.innerHTML =
    `<span class="tick-id">#${tick.tick_index}</span>` +
    `<span class="commit-msg">${tick.effects_summary.size}p</span>`;
  commitLogEl.appendChild(li);
  if (commitLogEl.children.length > 100) commitLogEl.firstChild?.remove();
});

// ── Execution handle & restart ────────────────────────────────────────────

let battleHandle: ReturnType<typeof executeByElement> | null = null;
let battleFxContainer: HTMLElement | null = null;

// addedNodes は直接の子のみ。孫の fx-effect も拾うため querySelectorAll で補完する。
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
      battleHandle = executeByElement(el as FxEffectElement, fxContext);
    });
});
mo.observe(document.body, { subtree: true, childList: true });

// restart: restart$ への単一 submitPlan で全状態をリセットする。
// $playerHP と $enemyHP が同一 DripPlan 内で更新されるため
// lift($battleActive) が CommitConflict を起こさない。
const restart = async () => {
  battleHandle?.cancel();
  battleHandle = null;

  await clock.submitPlan([restart$,undefined]);

  if (battleFxContainer) {
    const old = battleFxContainer.querySelector("fx-effect");
    if (old) battleFxContainer.removeChild(old);
    await new Promise<void>((res) => setTimeout(res, 30));
    battleFxContainer.appendChild(BattleEffect(fxContext) as FxEffectElement);
  }
};

// ── Event delegation ──────────────────────────────────────────────────────

document.addEventListener("click", (e: MouseEvent) => {
  const id = (e.target as HTMLElement).id;
  switch (id) {
    case "btn-attack":
      // actionChoice$ と phase$ は共通の lift 派生先を持たないため sub() 安全
      sub([actionChoice$,"attack"], [phase$,"acting"]);
      break;
    case "btn-magic":
      sub([actionChoice$,"magic"], [phase$,"acting"]);
      break;
    case "btn-item":
      sub([actionChoice$,"item"], [phase$,"item-select"]);
      break;
    case "btn-potion":
      sub([itemChoice$,"potion"], [phase$,"acting"]);
      break;
    case "btn-ether":
      sub([itemChoice$,"ether"], [phase$,"acting"]);
      break;
    case "btn-restart":
      restart();
      break;
  }
}, { capture: true });

// ── Build & mount ─────────────────────────────────────────────────────────

document.head.appendChild(styleElement);
document.title = "blooky showcase / battle";

const battleFxEl = BattleEffect(fxContext) as FxEffectElement;

const perfInnerEl = jshtml({
  div: [
    // 敵エリア
    {
      div: [
        {
          div: [
            { div: "🐉", $: { class: "enemy-sprite" } },
            { div: "ドラゴン", $: { class: "enemy-name" } },
            { div: $turnLabel, $: { class: "turn-badge" } },
          ],
          $: { class: "enemy-header" },
        },
        {
          div: [
            {
              div: [
                { span: "HP", $: { class: "stat-key" } },
                { span: $enemyHPText, $: { class: "stat-val" } },
              ],
              $: { class: "stat-head" },
            },
            {
              div: [
                { div: "", $: { class: "bar-fill", style: { width: $enemyHPPct, "background-color": $enemyHPColor } } },
              ],
              $: { class: "bar-track" },
            },
          ],
          $: { class: "stat-row" },
        },
      ],
      $: { class: "enemy-card" },
    },

    // バトルログ
    { div: $logNodes, $: { class: "battle-log" } },

    // プレイヤーエリア
    {
      div: [
        { div: "勇者", $: { class: "player-name" } },
        {
          div: [
            {
              div: [
                { span: "HP", $: { class: "stat-key" } },
                { span: $playerHPText, $: { class: "stat-val" } },
              ],
              $: { class: "stat-head" },
            },
            {
              div: [
                { div: "", $: { class: "bar-fill", style: { width: $playerHPPct, "background-color": $playerHPColor } } },
              ],
              $: { class: "bar-track" },
            },
          ],
          $: { class: "stat-row" },
        },
        {
          div: [
            {
              div: [
                { span: "MP", $: { class: "stat-key" } },
                { span: $playerMPText, $: { class: "stat-val" } },
              ],
              $: { class: "stat-head" },
            },
            {
              div: [
                { div: "", $: { class: "bar-fill bar-mp", style: { width: $playerMPPct } } },
              ],
              $: { class: "bar-track" },
            },
          ],
          $: { class: "stat-row" },
        },
      ],
      $: { class: "player-card" },
    },

    // アクションエリア
    {
      div: [
        {
          div: [
            { button: "⚔️ 攻撃",                     $: { class: "btn btn-attack", id: "btn-attack" } },
            { button: `✨ 魔法  MP:${MAGIC_MP_COST}`, $: { class: "btn btn-magic",  id: "btn-magic"  } },
            { button: "🎒 アイテム",                  $: { class: "btn btn-item",   id: "btn-item"   } },
          ],
          $: { class: $actionPanelClass },
        },
        {
          div: [
            { button: $potionLabel, $: { class: "btn btn-item-use", id: "btn-potion", disabled: $potionDisabled } },
            { button: $etherLabel,  $: { class: "btn btn-item-use", id: "btn-ether",  disabled: $etherDisabled  } },
          ],
          $: { class: $itemPanelClass },
        },
        { div: $statusText, $: { class: "status-text" } },
      ],
      $: { class: "action-area" },
    },

    // fx-effect ライブ実行ツリー
    battleFxEl,

    // リザルトオーバーレイ
    { div: $resultOverlay },
  ],
  $: { class: "battle-wrap" },
}) as HTMLElement;

battleFxContainer = perfInnerEl;

const app = jshtml({
  div: [
    {
      header: [
        { div: [{ em: "bloo" }, "ky"], $: { class: "logo" } },
        { span: "execution as observable facts", $: { class: "tagline" } },
        { span: "showcase / battle",             $: { class: "header-badge" } },
      ],
      $: { class: "showcase-header" },
    },
    {
      main: [
        {
          section: [
            { div: "The Score", $: { class: "panel-label" } },
            {
              p: "fx-race が勝敗とループを競わせ、fx-yield がテンプレートにプレイヤー入力を委譲。fx-switch が戻り値でアクション分岐する。",
              $: { class: "panel-desc" },
            },
            buildScorePanel(),
            {
              div: [
                { div: [{ div: "", $: { class: "legend-dot", style: { background: "var(--amber)" } } }, { span: "running" }],   $: { class: "legend-item" } },
                { div: [{ div: "", $: { class: "legend-dot", style: { background: "var(--blue)" } } },  { span: "suspended" }], $: { class: "legend-item" } },
                { div: [{ div: "", $: { class: "legend-dot", style: { background: "var(--green)" } } }, { span: "completed" }], $: { class: "legend-item" } },
                { div: [{ div: "", $: { class: "legend-dot", style: { background: "var(--red)" } } },   { span: "cancelled" }], $: { class: "legend-item" } },
              ],
              $: { class: "legend" },
            },
          ],
          $: { class: "panel panel-score" },
        },
        {
          section: [
            { div: "The Performance", $: { class: "panel-label" } },
            {
              p: "ターンごとに fx-loop が回り、fx-yield が入力を待ちながら fx-race が勝敗条件を監視する。",
              $: { class: "panel-desc" },
            },
            perfInnerEl,
          ],
          $: { class: "panel panel-performance" },
        },
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

