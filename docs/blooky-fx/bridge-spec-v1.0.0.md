# blooky-fx Bridge Specification v1.0.0

**Subtitle:** Execution ↔ FRP Bridge, Clock & Atomic Commit Model
**Status:** Draft (Pre-release, **Freeze Candidate**)
**Depends on:** score-fx Protocol Specification v1.0.0

---

## 0. Purpose and Scope

本仕様は、**score-fx Protocol の実行結果（StepRecord）**を
**FRP システム（blooky-fp）への更新（Prop commit）**に変換する
**最小かつ決定的な接着剤（Bridge）**を定義する。

本仕様が規定するのは、以下のみである：

1. StepRecord（PerformanceStep の列）を Tick に分割する規則
2. Tick 内の effect を収集し、Effect Map に正規化する規則
3. Effect Map を FRP へ atomic commit する契約
4. Clock / Observer / Conflict 禁止の境界条件
5. Execution と FRP が値を共有・参照するための FxRef / AppContext / resolveValue の正規化規則

本仕様は以下を **明示的に対象外**とする：

* score-fx の実行意味論
  （Phase 遷移、suspend / resume、terminate / cancel）
* FRP コアの演算仕様
  （map / merge / lift 等）
* effect の意味解釈
  （Bridge Profile の責務）
* DevTools / UI / DOM 投影モデル

### 依存関係（Normative）

* 本仕様は **score-fx Protocol Specification v1.0.0** に準拠しなければならない（MUST）
* `PerformanceStep` / `PerformancePhase` / `StepRecord` は score-fx の定義を参照する

---

## 1. Fundamental Model

### 1.1 Tick

Tick とは、
**複数の Prop 更新が「同時に確定した」とみなされる最小の時間単位**である。

* Tick は Atomic Commit の境界である
* Tick 内の更新は、外部から逐次的に観測されてはならない（MUST NOT）

### 1.2 Clock

Clock は Tick を生成する時間源である。

* Clock は Tick ごとに単調増加する値を提供してよい（MAY）
* Clock は Execution / FRP / Observation を同一 Tick に整列させる唯一の基準である
* Clock の実装方式（RAF / timeout / virtual time 等）は本仕様では規定しない

### 1.3 Effect Map

Effect Map は、Tick 内で確定される Prop 更新の集合である。

概念的には以下と等価である：

```ts
Map<Prop<any>, any>
```

* Effect Map は **値の集合**であり、実行命令ではない
* 内部構造・列挙順序・保持形式は意味を持たない

---

## 2. Atomic Commit Rules

### 2.1 Atomicity

同一 Tick 内のすべての Prop 更新は、
**同時に適用されたとみなされなければならない**（MUST）。

* 中間状態を観測可能にしてはならない（MUST NOT）
* Tick は「部分適用」を持たない

### 2.2 Order Independence

Effect Map に含まれる更新は、

* 格納順序
* 列挙順序
* 内部実装順序

に依存してはならない（MUST NOT）。

同一 Tick の結果は、順序に関係なく常に一致しなければならない（MUST）。

### 2.3 Deduplication (Optional)

Prop の更新結果が既存値と同一である場合：

* 実装はその更新を省略してよい（MAY）
* 省略は意味論に影響してはならない

### 2.4 Step Ordering（Normative）

Bridge は **StepRecord の順序を `step_index` に基づいて解釈しなければならない**（MUST）。

* StepRecord 内の Step は `step_index` の昇順で処理される（MUST）
* `timestamp` は telemetry / logging 用途に使ってよい（MAY）
* `timestamp` を順序決定に使用してはならない（MUST NOT）

---

## 3. Conflict Prohibition

### 3.1 Conflict Definition

Conflict とは、同一 Tick 内において：

* 同一の Prop に対し
* 異なる値が同時に適用される

状況を指す。

### 3.2 Conflict MUST NOT Occur

同一 Tick 内における Prop 更新の Conflict は
**仕様違反であり、発生してはならない**（MUST NOT）。

* 競合は「データフロー設計の誤り」である
* Execution / Bridge 層は競合解決戦略を提供しない
* 分岐・統合・条件選択は FRP 側の構造で表現されるべきである

---

## 4. Tick Reservation and Effect Collection

### 4.1 Effect Extraction（Normative）

Bridge は StepRecord から effect を抽出する。

1. Runner が生成した `PerformanceStep` を受け取る（MUST）
2. Step に `effect` フィールド（opaque）が存在する場合、それを取り出す（MUST）
3. 取り出した effect は、**Bridge Profile に従って解決しなければならない**（MUST）

**Normative note:**

* Bridge は effect の意味を直接解釈してはならない（MUST NOT）
* effect → `(Prop, value)` の変換は Bridge Profile の責務である

### 4.2 Tick Assignment（Normative）

Bridge は複数の Step を Tick に割り当ててよい（MAY）。

割り当て戦略は実装定義だが、以下を満たさなければならない（MUST）：

* 同一 `execution_id` の Step は `step_index` 順に処理される
* Tick 境界をまたいだ順序逆転は発生してはならない（MUST NOT）

**推奨される戦略（Informative）:**

* 同期的に生成された Step 群は同一 Tick にまとめることが推奨される
* 非同期境界（例：suspend / resume の前後）で Tick を分割してよい
* Clock の 1 フレーム内に生成された Step を同一 Tick とすることが一般的である

### 4.3 Merge Rule

複数の effect が存在する場合、最終的な Effect Map は：

* Prop ごとに一意な更新のみを含む（MUST）
* Conflict を含んではならない（MUST NOT）

---

## 5. Observer Contract

### 5.1 Observer Role

Observer は Tick における Effect Map を受け取り：

* UI 更新
* DevTools 通知
* 外部システムへの投影

を行う。

Observer は **観測者であり、意味論を追加しない**。

### 5.2 Atomic Observation

Observer は Tick を Atomic Commit として扱わなければならない（MUST）。

* Tick 内の部分更新を逐次処理してはならない
* 観測結果は「確定後の状態」のみを表す

### 5.3 Observer Failure Policy（Strict）

本仕様では **Strict Policy** を採用する。

* Observer 内で例外（throw）が発生した場合、Tick 全体は失敗とみなされる（MUST）
* 当該 Tick に予約されたすべての処理は reject される
* 観測は特権であり、失敗は無視可能な副作用ではない

**Normative note:**

Observer の失敗は **FRP commit の失敗**を意味する。
score-fx の実行（StepRecord の生成）は既に完了しており、
Observer の失敗によって **過去の Step が取り消されることはない**（MUST NOT）。

---

## 6. Bridge Profile（Normative）

Bridge Profile は、Bridge が以下を解釈するための契約である：

1. **Effect Resolution**
   `PerformanceStep.effect`（opaque）を `(Prop, value)` に変換する方法
2. **Context Resolution**
   AppContext からの値参照を解決する方法
3. **Tick Strategy（Optional）**
   Step を Tick に割り当てる戦略

### 6.1 AppContext

AppContext は、Execution と FRP が共有する辞書である。

* 任意のキー（string / symbol）を持ちうる（MAY）
* 値は即値・Prop のいずれも取りうる（MAY）
* AppContext の保護・委譲・Proxy 化は実装に委ねる（MAY）

### 6.2 FxRef

FxRef は以下のいずれかである：

* AppContext のキー参照
* Prop<T>
* 即値 T

FxRef は記述上の利便性のための型であり、
Bridge の意味論を変更しない。

### 6.3 resolveValue（Normative）

```ts
resolveValue<T>(ref: FxRef<T>, appContext: AppContext): Prop<T>
```

規則：

* `Prop<T>` → そのまま返す（MUST）
* 即値 `T` → `() => T` にラップして返す（MUST）
* AppContext 参照 → 値取得後、上記規則で正規化（MUST）

**Note (Normative):**
本仕様における Prop<T> とは、blooky-fp における定義に従い、
`() => T` を含む pull-based value source の総称である。

---

## 7. Design Consequences（Normative）

本仕様により、以下が保証される：

* Execution / FRP / DevTools は同一 Tick に同期する
* Prop 更新は常に原子的に観測される
* 競合は設計段階で排除され、実行時に曖昧さを残さない
* Bridge 層は薄く、決定的であり、意味論を持たない

---

## 8. Frozen Declaration（候補）

🔒 **Frozen (upon release)**

* v1.0.0 公開後、後方互換を破る変更を行わない
* 拡張は Appendix または v1.1 以降で行う
* Conflict MUST NOT / Strict Observer Policy は不変とする

---

## Appendix A: Bridge Type Definitions（Normative）

### A.1 Bridge Input

Bridge の入力は、score-fx が定義する型を使用する：

```ts
import type {
  PerformanceStep,
  PerformancePhase,
  StepRecord
} from "score-fx";
```

**Bridge は PerformanceStep を再定義してはならない（MUST NOT）。**

### A.2 Effect Map

```ts
type EffectMap = Map<Prop<any>, any>;
```

実装形式は規定しない（MAY vary）。
同一 Tick 内で Prop ごとに一意な値を保持することのみが要件である。

### A.3 Bridge Profile Interface

```ts
export type TickId = string | number;

interface BridgeProfile {
  resolveEffect(
    effect: unknown,
    context: AppContext
  ): [Prop<any>, any] | null;

  assignTick?(step: PerformanceStep): TickId;
}
```

### A.4 CancelReason

```ts
export type CancelReason =
  | "user"
  | "timeout"
  | "error";
```

**Normative note:**

* `terminate` は score-fx の SemanticEvent であり、Bridge の cancel reason ではない
* Bridge は cancel を観測しうるが、その意味解釈は行わない（MUST NOT）

### A.5 CancelToken

```ts
export type CancelToken = {
  parent?: CancelToken;
  cancel: (reason?: CancelReason) => void;
  cancelled: () => boolean;
  reason?: CancelReason;
};
```

### A.6 AppContext

```ts
export type AppContext = Record<string | symbol, unknown>;
```

### A.7 FxRef

```ts
export type FxRef<T> =
  | { key: string | symbol }
  | Prop<T>
  | T;
```

---

## Appendix B: Non-goals / Out of Scope

* FRP コア意味論（Stream / Prop の計算モデル）
* Promise / async 計算モデル
* Effect の戦略的スケジューリング（debounce / throttle 等）
* 実行介入（Middleware）
* UI / Projection / DevTools 表現モデル

---

## Appendix C: Normative Clarifications

### C.1 Observer Failure Policy（Strict）

Observer 内で例外が発生した場合：

* Tick は失敗として扱われる
* 例外は握り潰されない
* 成功として継続しない

### C.2 同一 Tick 内の競合禁止

同一 Tick 内において、同一 Prop に異なる値を適用することは MUST NOT。
blooky-fx は競合解決規則を提供しない。

---

**END OF blooky-fx Bridge Specification v1.0.0**

どちらに進むか、指示してください。
