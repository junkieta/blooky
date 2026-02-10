# blooky-fx Bridge Specification v1.0.0

**Subtitle:** Execution ↔ FRP Bridge, Clock & Atomic Commit Model
**Status:** 🔒 Final / Frozen
**Depends on:** score-fx Protocol Specification v1.0.0
**Scope:** Execution Result → FRP Commit Adapter

---

## 0. Purpose and Scope

本仕様は、**score-fx Protocol v1.0.0 が生成する実行結果（StepRecord）**を
**FRP システム（例：blooky-fp）における Prop 更新（Atomic Commit）**へ変換する
**最小かつ決定的な接着剤（Bridge）**を定義する。

本仕様が **規定するもの** は以下のみである：

1. StepRecord（PerformanceStep の列）を Tick に割り当てる規則
2. Tick 内の effect を収集し、Effect Map に正規化する規則
3. Effect Map を FRP に atomic commit する契約
4. Clock / Observer / Conflict 禁止に関する境界条件

本仕様が **明示的に対象外とするもの**：

* score-fx の実行意味論
  （Phase 遷移、suspend / resume、terminate / cancel）
* FRP コアの演算仕様
  （map / merge / lift 等）
* effect の意味解釈
  （Bridge Profile の責務）
* DevTools / UI / DOM 投影モデル

**依存関係（Normative）**：

* 本仕様は score-fx Protocol Specification v1.0.0 に準拠する（MUST）
* PerformanceStep / PerformancePhase / StepRecord の定義は score-fx に従う
* Bridge は PerformanceStep を再定義してはならない（MUST NOT）

---

## 1. Fundamental Model

### 1.1 Tick

Tick とは、**複数の Prop 更新が「同時に確定した」とみなされる最小の時間単位**である。

* Tick は Atomic Commit の境界である
* Tick 内の中間状態は観測されてはならない（MUST NOT）
* Tick は「部分適用」を持たない

---

### 1.2 Clock

Clock は Tick を生成する時間源である。

* Clock は Tick ごとに単調増加する値を提供してよい（MAY）
* Clock は Execution / UI / Observation を同一 Tick に整列させる唯一の基準である
* Clock の実装方式（RAF / timeout / virtual time 等）は規定しない

---

### 1.3 Effect Map

Effect Map は、Tick 内で確定される Prop 更新の集合である。

* 概念的には `Map<Prop<any>, any>` と等価
* Effect Map は **値の集合**であり、実行命令ではない
* 内部構造・列挙順序・保持形式は意味を持たない

---

## 2. Atomic Commit Rules

### 2.1 Atomicity（Normative）

同一 Tick 内のすべての Prop 更新は、同時に適用されたとみなされなければならない（MUST）。

* 中間状態を観測可能にしてはならない（MUST NOT）
* Tick は部分適用を持たない

---

### 2.2 Order Independence（Normative）

Effect Map に含まれる更新は、

* 格納順序
* 列挙順序
* 内部実装順序

に依存してはならない（MUST NOT）。

---

### 2.3 Deduplication（Optional）

同一 Prop に対する更新が既存値と同一である場合：

* 実装はその更新を省略してよい（MAY）
* 省略は意味論に影響してはならない

---

### 2.4 Step Ordering（Normative）

Bridge は StepRecord の順序を **step_index** に基づいて解釈しなければならない（MUST）。

* Step は step_index の昇順で処理される（MUST）
* timestamp は telemetry / logging 用途に使用してよい（MAY）
* timestamp を順序決定に使用してはならない（MUST NOT）

---

## 3. Conflict Prohibition

### 3.1 Conflict Definition

Conflict とは、同一 Tick 内において：

* 同一の Prop に対し
* 異なる値が同時に適用される

状況を指す。

---

### 3.2 Conflict MUST NOT Occur（Normative）

同一 Tick 内での Conflict は仕様違反であり、発生してはならない（MUST NOT）。

* Bridge は競合解決戦略を提供しない
* 分岐・統合は FRP 側の構造で表現されるべきである

---

## 4. Tick Reservation and Effect Collection

### 4.1 Effect Extraction（Normative）

Bridge は StepRecord から effect を抽出する。

1. Runner が生成した PerformanceStep を受け取る（MUST）
2. Step に `effect` フィールド（opaque）が存在する場合、それを取り出す（MUST）
3. 取り出した effect は Bridge Profile に従って解決しなければならない（MUST）

**Normative note**：

* Bridge は effect の意味を直接解釈してはならない（MUST NOT）
* effect → `(Prop, value)` の列（0..N件）への変換は Bridge Profile の責務である

---

### 4.2 Tick Assignment（Normative）

Bridge は複数の Step を同一 Tick に割り当ててよい（MAY）。

ただし以下を満たさなければならない（MUST）：

* 同一 execution_id の Step は step_index 順に処理される
* Tick 境界をまたいだ順序逆転は発生してはならない（MUST NOT）

**推奨戦略（Informative）**：

* 同期的に生成された Step 群を同一 Tick にまとめる
* suspend / resume の前後で Tick を分割する
* Clock の 1 フレームを Tick 境界とする

---

### 4.3 Merge Rule（Normative）

最終的な Effect Map は：

* Prop ごとに一意な更新のみを含む（MUST）
* Conflict を含んではならない（MUST NOT）

**Note (Informative)**：
Bridge Profile が 1 effect から複数の更新（0..N）を返す場合でも、
それらは同一 Tick の Effect Map に統合され、Atomic commit される。

---

## 5. Observer Contract

### 5.1 Observer Role

Observer は Tick における Effect Map を受け取り：

* UI 更新
* DevTools 通知
* 外部システムへの投影

を行う。

Observer は観測者であり、意味論を追加してはならない。

---

### 5.2 Atomic Observation（Normative）

Observer は Tick を Atomic Commit として扱わなければならない（MUST）。

* Tick 内の部分更新を逐次処理してはならない
* 観測結果は確定後の状態のみを表す

---

### 5.3 Observer Failure Policy（Strict）

* Observer 内で例外が発生した場合、Tick 全体は失敗とみなされる（MUST）
* 当該 Tick に予約されたすべての処理は reject される
* 観測は特権であり、失敗は無視可能な副作用ではない

**Normative note**：

* Observer の失敗は FRP commit の失敗を意味する
* score-fx の StepRecord は既に確定しており、
  Observer の失敗によって過去の Step が取り消されることはない（MUST NOT）

---

## 6. Bridge Profile（Normative）

Bridge Profile は、Bridge が以下を解釈するための契約である：

1. **Effect Resolution**
   `PerformanceStep.effect`（opaque）を `(Prop, value)` の列（0..N件）に変換する方法
2. **Context Resolution**
   AppContext からの値参照を解決する方法
3. **Tick Strategy（Optional）**
   Step を Tick に割り当てる戦略

---

## 7. Design Consequences（Normative）

本仕様により以下が保証される：

* Execution / UI / DevTools は同一 Tick に同期する
* Prop 更新は常に原子的に観測される
* Conflict は設計段階で排除され、実行時に曖昧さを残さない
* Bridge 層は薄く、意味論を持たない

---

## 8. Frozen Declaration

🔒 **Frozen**

* 本仕様は後方互換を壊す変更を行わない
* 拡張は Appendix または v1.1 以降で行う
* Conflict 禁止および Strict Observer Policy は不変とする

---

# Appendix A: Bridge Type Definitions（Normative）

```ts
export type TickId = string | number;

export type AppContext = Record<string | symbol, unknown>;

export type FxRef<T> =
  | { key: string | symbol }
  | Prop<T>
  | T;

interface BridgeProfile {
  /**
   * effect (opaque) を (Prop, value) の列に解決する。
   * - 不明/非対応の effect は null
   * - 有効だが更新なしの場合は [] を返してよい
   * - 単一更新は [[prop, value]]
   * - 複数更新は [[p1,v1],[p2,v2],...]
   */
  resolveEffect(
    effect: unknown,
    context: AppContext
  ): Array<[Prop<any>, any]> | null;

  assignTick?(step: PerformanceStep): TickId;
}
```

---

# Appendix B: Out of Scope / Non-goals（Normative Boundary）

本 Appendix は、本仕様が **意図的に定義しない領域**を列挙する。

以下は **Bridge v1.0.0 の責務ではない**：

* FRP コア意味論
  （Stream / Prop の計算モデル、map / merge / lift 等）
* Promise / async 計算モデル
  （awaitable stream、再駆動規則等）
* Effect の戦略的スケジューリング
  （debounce / throttle / queue 等）
* 実行介入・Middleware
  （ExecutionStep の横断的改変）
* UI / Projection / DevTools 表示意味論

これらは上位層または別仕様の責務である。

---

# Appendix C: Normative Clarifications（挙動固定）

本 Appendix は、既存実装で暗黙に採用されていた挙動のうち、
**v1.0.0 で仕様として固定するもの**を列挙する。

### C.1 Observer Failure Policy（Strict）

* Observer 内で例外が発生した場合、Tick は失敗として扱う
* 例外は握り潰されず、呼び出し元に伝播する
* Tick 成功として継続してはならない

### C.2 Same-Tick Conflict Prohibition

* 同一 Tick 内で同一 Prop に異なる値を適用してはならない（MUST NOT）
* Bridge は競合解決規則を提供しない
* 競合は設計エラーとして早期に検出されるべきである

---

# Appendix D: Bridge Profile Examples（Informative）

> **Note**: 以下のコード例は説明用の擬似コードであり、実装を拘束しない。

## D.1 Minimal Profile（Single Update）

```ts
const minimalProfile: BridgeProfile = {
  resolveEffect(effect, ctx) {
    if (effect.type !== "set-prop") return null;
    return [[
      resolveValue(effect.target, ctx),
      resolveValue(effect.value, ctx)()
    ]];
  }
};
```

---

## D.2 Multiple Updates（Batch Pattern）

### Approach A: Runner 側で分解

### Approach B: Profile 側で一括解決（drip 向き）

（どちらも有効。実装方針により選択）

---

## D.5 Conflict Detection and Tick Failure（Strict）

```ts
function mergeUpdatesIntoEffectMapStrict(
  map: Map<Prop<any>, any>,
  updates: Array<[Prop<any>, any]>
) {
  for (const [p, v] of updates) {
    if (!map.has(p)) { map.set(p, v); continue; }
    if (Object.is(map.get(p), v)) continue;
    throw new BridgeConflictError("Conflict in same Tick");
  }
}
```

---

## D.6 Summary

* Bridge は effect を解釈しない
* Profile が `(Prop, value)` の列（0..N件）に正規化する
* 単一・複数更新は同一モデルで扱われる
* Conflict は Tick failure
* StepRecord は決して巻き戻らない

---

🔒 **blooky-fx Bridge Specification v1.0.0 — Final / Frozen**

---
