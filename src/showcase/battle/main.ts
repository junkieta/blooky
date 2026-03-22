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
import { Stream } from "../../blooky-fp-types";
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

const sub = (...plans: { dripper: any; value: any }[]) =>
  Promise.all(plans.map((p) => clock.submitPlan(p)));

// ターン開始時のリセット
const resetTurn = async () => {
  await sub(
    { dripper: actionReset$, value: undefined },
    { dripper: itemReset$,   value: undefined },
    { dripper: phase$,       value: "waiting" },
    { dripper: turnInc$,     value: undefined },
  );
};

const doAttack = async () => {
  const dmg = Math.floor(Math.random() * 15) + 8; // 8–22
  await sub(
    { dripper: enemyDmg$,  value: dmg },
    { dripper: logEntry$,  value: `⚔️  攻撃！${dmg} ダメージ！` },
  );
};

const doMagic = async () => {
  if ($playerMP() < MAGIC_MP_COST) {
    await clock.submitPlan({ dripper: logEntry$, value: "💧 MP が足りない！" });
    return;
  }
  const dmg = Math.floor(Math.random() * 20) + 15; // 15–34
  await sub(
    { dripper: mpSpend$,   value: MAGIC_MP_COST },
    { dripper: enemyDmg$,  value: dmg },
    { dripper: logEntry$,  value: `✨ ファイア！${dmg} ダメージ！` },
  );
};

const doItem = async () => {
  const item = $selectedItem();
  const pc   = $potionCount();
  const ec   = $etherCount();
  if (item === "potion" && pc > 0) {
    await sub(
      { dripper: playerHeal$, value: 30 },
      { dripper: potionUse$,  value: pc - 1 },
      { dripper: logEntry$,   value: "💊 ポーション！HP +30！" },
    );
  } else if (item === "ether" && ec > 0) {
    await sub(
      { dripper: mpHeal$,    value: 20 },
      { dripper: etherUse$,  value: ec - 1 },
      { dripper: logEntry$,  value: "💎 エーテル！MP +20！" },
    );
  } else {
    await clock.submitPlan({ dripper: logEntry$, value: "❌ 使えない！" });
  }
};

const doEnemyTurn = async () => {
  await clock.submitPlan({ dripper: phase$, value: "enemy" });
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
    { dripper: playerDmg$, value: dmg },
    { dripper: logEntry$,  value: msg },
  );
};

const onVictory = async () => {
  await sub(
    { dripper: result$,   value: "victory" as BattleResult },
    { dripper: logEntry$, value: "🏆 勝利！ドラゴンを倒した！" },
    { dripper: phase$,    value: "result" },
  );
};

const onDefeat = async () => {
  await sub(
    { dripper: result$,   value: "defeat" as BattleResult },
    { dripper: logEntry$, value: "💀 敗北…勇者は力尽きた…" },
    { dripper: phase$,    value: "result" },
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

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;600&display=swap');

  :root {
    --bg:       #0d0f12;  --bg-panel: #13161b;  --bg-inset: #0a0c0f;
    --border:   #222630;  --text:     #c8cdd8;  --text-dim: #4a5068;
    --text-mid: #7a83a0;  --green:    #34d399;  --amber:    #fbbf24;
    --blue:     #60a5fa;  --purple:   #a78bfa;  --red:      #f87171;
    --mono: 'IBM Plex Mono', monospace;
    --sans: 'IBM Plex Sans', sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.6; min-height: 100vh; }

  .showcase { display: grid; grid-template-rows: auto 1fr auto; min-height: 100vh; }

  .showcase-header { padding: 1.5rem 2.5rem; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 1.5rem; }
  .logo { font-family: var(--mono); font-size: 1.3rem; font-weight: 600; color: #fff; letter-spacing: -0.02em; }
  .logo em { color: var(--green); font-style: normal; }
  .tagline { font-family: var(--mono); font-size: 0.68rem; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
  .header-badge { margin-left: auto; font-family: var(--mono); font-size: 0.65rem; color: var(--text-dim); border: 1px solid var(--border); padding: 0.2em 0.65em; border-radius: 2px; }

  .showcase-main { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--border); }
  .panel { padding: 1.75rem 2rem; display: flex; flex-direction: column; gap: 1rem; }
  .panel-score { border-right: 1px solid var(--border); overflow: hidden; }
  .panel-label { font-family: var(--mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-dim); }
  .panel-desc  { font-size: 0.78rem; color: var(--text-mid); line-height: 1.65; }

  .score-code { background: var(--bg-inset); border: 1px solid var(--border); border-radius: 4px; padding: 1rem 1.2rem; font-family: var(--mono); font-size: 0.63rem; line-height: 1.85; overflow: auto; flex: 1; min-height: 0; }
  .score-line { display: block; white-space: pre; }
  .token.tag       { color: #7dd3fc; }
  .token.attr-name { color: #a5f3fc; }
  .token.attr-val  { color: #86efac; }
  .token.punct     { color: var(--text-dim); }
  .token.comment   { color: var(--text-dim); font-style: italic; }

  .battle-wrap { position: relative; flex: 1; display: flex; flex-direction: column; gap: 0.7rem; min-height: 0; }

  .enemy-card, .player-card {
    background: var(--bg-inset); border: 1px solid var(--border); border-radius: 5px;
    padding: 0.9rem 1.1rem; display: flex; flex-direction: column; gap: 0.6rem;
  }
  .enemy-header { display: flex; align-items: center; gap: 0.7rem; }
  .enemy-sprite { font-size: 1.8rem; line-height: 1; }
  .enemy-name   { font-family: var(--mono); font-size: 0.76rem; font-weight: 600; }
  .turn-badge   { margin-left: auto; font-family: var(--mono); font-size: 0.6rem; color: var(--text-dim); border: 1px solid var(--border); padding: 0.1em 0.5em; border-radius: 2px; min-width: 3.5em; text-align: center; }
  .player-name  { font-family: var(--mono); font-size: 0.73rem; font-weight: 600; }

  .stat-row  { display: flex; flex-direction: column; gap: 0.25rem; }
  .stat-head { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 0.62rem; }
  .stat-key  { color: var(--text-dim); }
  .stat-val  { color: var(--text-mid); }
  .bar-track { height: 5px; background: var(--bg-panel); border-radius: 3px; overflow: hidden; border: 1px solid var(--border); }
  .bar-fill  { height: 100%; border-radius: 3px; transition: width 0.4s ease, background-color 0.4s; }
  .bar-mp    { background: #818cf8 !important; }

  .battle-log { background: var(--bg-inset); border: 1px solid var(--border); border-radius: 4px; padding: 0.65rem 0.9rem; min-height: 4.5rem; display: flex; flex-direction: column; gap: 0.15rem; overflow: hidden; }
  .log-entry { font-family: var(--mono); font-size: 0.68rem; color: var(--text-mid); animation: slide-in 0.15s ease; line-height: 1.45; }
  .log-start { color: var(--text-dim); font-style: italic; }
  @keyframes slide-in { from { opacity:0; transform:translateX(-5px); } to { opacity:1; transform:none; } }

  .action-area { display: flex; flex-direction: column; gap: 0.45rem; }
  .action-panel, .item-panel { display: flex; gap: 0.45rem; flex-wrap: wrap; transition: opacity 0.15s, height 0.15s; }
  .action-panel.hidden, .item-panel.hidden { opacity: 0; pointer-events: none; height: 0; overflow: hidden; margin: 0; padding: 0; }
  .status-text { font-family: var(--mono); font-size: 0.7rem; color: var(--text-mid); min-height: 1.4em; }

  .btn { font-family: var(--mono); font-size: 0.7rem; padding: 0.38em 0.9em; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-panel); color: var(--text); cursor: pointer; transition: border-color 0.12s, color 0.12s, background 0.12s; }
  .btn:hover:not([disabled]) { border-color: var(--text-mid); }
  .btn[disabled] { opacity: 0.32; cursor: not-allowed; }
  .btn-attack { border-color: var(--amber);  color: var(--amber);  }
  .btn-attack:hover:not([disabled]) { background: rgba(251,191,36,0.07); }
  .btn-magic  { border-color: var(--purple); color: var(--purple); }
  .btn-magic:hover:not([disabled])  { background: rgba(167,139,250,0.07); }
  .btn-item   { border-color: var(--blue);   color: var(--blue);   }
  .btn-item:hover:not([disabled])   { background: rgba(96,165,250,0.07); }
  .btn-restart { border-color: var(--green); color: var(--green); }
  .btn-restart:hover { background: rgba(52,211,153,0.08); }
  .btn-item-use { border-color: var(--border); color: var(--text-mid); font-size: 0.66rem; }
  .btn-item-use:hover:not([disabled]) { border-color: var(--blue); color: var(--blue); }

  .result-overlay {
    position: absolute; inset: 0;
    background: rgba(13,15,18,0.9);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.8rem;
    border-radius: 6px; z-index: 10; animation: fade-in 0.3s ease;
  }
  .result-overlay.hidden { display: none; }
  @keyframes fade-in { from { opacity:0; } to { opacity:1; } }
  .result-icon  { font-size: 2.5rem; }
  .result-title { font-family: var(--mono); font-size: 1.4rem; font-weight: 600; letter-spacing: 0.12em; }
  .result-title.victory { color: var(--green); }
  .result-title.defeat  { color: var(--red);   }
  .result-sub   { font-size: 0.8rem; color: var(--text-mid); }

  fx-effect, fx-sequence, fx-yield, fx-wait, fx-call,
  fx-switch, fx-if, fx-race, fx-loop {
    display: block; font-family: var(--mono); font-size: 0.65rem;
    padding: 0.25rem 0.6rem 0.25rem 0.7rem;
    border-left: 2.5px solid var(--border); border-radius: 0 3px 3px 0;
    background: var(--bg-inset); margin: 1.5px 0;
    transition: border-color 0.2s, background 0.2s, color 0.2s;
  }
  fx-sequence, fx-race, fx-loop
    { background: transparent; color: var(--text-mid); border-left-color: transparent; }
  fx-sequence:state(running), fx-race:state(running), fx-loop:state(running), fx-parallel:state(running)
    { border-left-color: var(--amber); }
  fx-sequence:state(completed), fx-race:state(completed), fx-loop:state(completed), fx-parallel:state(completed)
    { border-left-color: var(--green); }
  fx-sequence:state(cancelled), fx-race:state(cancelled), fx-loop:state(cancelled), fx-parallel:state(cancelled)
    { border-left-color: var(--red); opacity: 0.45; }

  fx-yield:state(running), fx-wait:state(running), fx-call:state(running),
  fx-switch:state(running), fx-if:state(running), fx-effect:state(running)
    { border-left-color: var(--amber); background: rgba(251,191,36,0.04); color: var(--text); }
  fx-yield:state(paused), fx-wait:state(paused)
    { border-left-color: var(--blue); background: rgba(96,165,250,0.05); color: var(--blue); animation: pulse 1.6s ease-in-out infinite; }
  fx-yield:state(completed), fx-wait:state(completed), fx-call:state(completed),
  fx-switch:state(completed), fx-if:state(completed), fx-effect:state(completed)
    { border-left-color: var(--green); background: rgba(52,211,153,0.04); color: var(--text-mid); }
  fx-yield:state(cancelled), fx-wait:state(cancelled), fx-loop:state(cancelled)
    { border-left-color: var(--red); opacity: 0.45; }

  fx-yield.is-running, fx-wait.is-running, fx-call.is-running, fx-switch.is-running, fx-if.is-running, fx-effect.is-running
    { border-left-color: var(--amber); background: rgba(251,191,36,0.04); color: var(--text); }
  fx-yield.is-paused, fx-wait.is-paused
    { border-left-color: var(--blue); background: rgba(96,165,250,0.05); color: var(--blue); animation: pulse 1.6s ease-in-out infinite; }
  fx-yield.is-completed, fx-wait.is-completed, fx-call.is-completed, fx-switch.is-completed, fx-if.is-completed, fx-effect.is-completed
    { border-left-color: var(--green); background: rgba(52,211,153,0.04); color: var(--text-mid); }
  fx-yield.is-cancelled, fx-wait.is-cancelled, fx-loop.is-cancelled
    { border-left-color: var(--red); opacity: 0.45; }

  @keyframes pulse {
    0%, 100% { box-shadow: inset 0 0 0 1px rgba(96,165,250,0.06); }
    50%       { box-shadow: inset 0 0 0 1px rgba(96,165,250,0.28); }
  }

  .legend { display: flex; gap: 1.1rem; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 0.35rem; font-family: var(--mono); font-size: 0.63rem; color: var(--text-mid); }
  .legend-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

  .showcase-footer { padding: 1.1rem 2rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.5rem; }
  .commit-log { list-style: none; display: flex; flex-wrap: wrap; gap: 0.28rem; max-height: 4rem; overflow: hidden; }
  .commit-entry { display: inline-flex; align-items: center; gap: 0.45rem; font-family: var(--mono); font-size: 0.63rem; padding: 0.14em 0.5em; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-panel); animation: entry-in 0.14s ease; }
  @keyframes entry-in { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
  .tick-id    { color: var(--text-dim); }
  .commit-msg { color: var(--green); }

  @media (max-width: 900px) {
    .showcase-main { grid-template-columns: 1fr; }
    .panel-score { border-right: none; border-bottom: 1px solid var(--border); max-height: 340px; }
  }
`;

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

  await clock.submitPlan({ dripper: restart$, value: undefined });

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
      sub({ dripper: actionChoice$, value: "attack" }, { dripper: phase$, value: "acting" });
      break;
    case "btn-magic":
      sub({ dripper: actionChoice$, value: "magic" }, { dripper: phase$, value: "acting" });
      break;
    case "btn-item":
      sub({ dripper: actionChoice$, value: "item" }, { dripper: phase$, value: "item-select" });
      break;
    case "btn-potion":
      sub({ dripper: itemChoice$, value: "potion" }, { dripper: phase$, value: "acting" });
      break;
    case "btn-ether":
      sub({ dripper: itemChoice$, value: "ether" }, { dripper: phase$, value: "acting" });
      break;
    case "btn-restart":
      restart();
      break;
  }
}, { capture: true });

// ── Build & mount ─────────────────────────────────────────────────────────

document.head.appendChild(
  Object.assign(document.createElement("style"), { textContent: STYLES })
);
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

