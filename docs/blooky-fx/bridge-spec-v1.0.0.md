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

* 概念的には Prop → value の部分写像
* 表現は Map<Prop<any>, any> でも Array<[Prop<any>, any]>でもよい（MAY）
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

同一 Tick 内で同一 Prop への異値更新が検出された場合、
Bridge は conflict を検出して Tick failure として確定しなければならない（MUST）。
Bridge は当該 Tick を commit してはならない（MUST NOT）。
Bridge は conflict 解決規則（優先順位・last-write-wins 等）を提供してはならない（MUST NOT）。

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

### 4.4 Cancellation Boundary Rules（Normative）

Bridge は `phase:"cancel"` を受理した execution について、以下を満たさなければならない（MUST）:

1. cancel 以後（cancel step_index より後）の Step は commit 対象に含めてはならない（MUST NOT）。。
2. cancel は 通常 Effect Map を変更しない（SHOULD NOT）。ただし cancel step に effect を載せる Profile を採用する場合は Profile が明示する（MUST）。

Bridge は以下を行ってよい（MAY）:

1. cancel 後に到着した Step を ignored として観測通知する。
2. 当該 execution に紐づく未処理 reservation を reject する。

**Failure boundary note（Normative）**:
ここでの reject は通知経路であり、未処理例外を境界外へ漏らす目的で使ってはならない（MUST NOT）。

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

この Strict Policy は bridge の設計選択であり、score-fx 依存ではない。

---

### 5.4 Error Model（Normative）

Bridge は、Tick の失敗を submit() の reject として表現する。
ただし、Bridge が「停止級（fatal）」とみなす失敗は reject 経路として扱ってはならない（MUST NOT）。

```ts
class ConflictError extends Error {
  readonly name = "ConflictError";
  constructor(
    readonly conflicts: Array<{ prop: Prop<any>; values: any[] }>
  ) {
    super("Conflict in CommitPlan");
  }
}

/**
 * Observer（Strict）内の例外により Tick が失敗したことを表す。
 * ObserverError は recoverable failure として submit() reject 経路に載る（MUST）。
 */
class ObserverError extends Error {
  readonly name = "ObserverError";
  constructor(
    readonly cause: unknown
  ) {
    super("Observer failed");
  }
}

/**
 * commit 実行中に発生した停止級（fatal）エラー。
 * これは recoverable failure ではなく、Runtime/FRP の整合性違反を意味する。
 *
 * Bridge/Runtime は、この例外を submit() reject 経路として扱ってはならない（MUST NOT）。
 * 実装はプロセス停止・再起動要求などの致命的処理を行うべきである（SHOULD）。
 */
class CommitExecutionError extends Error {
  readonly name = "CommitExecutionError";
  constructor(
    readonly cause: unknown
  ) {
    super("Commit execution failed");
  }
}

/**
 * submit() が reject で返しうる recoverable error の閉集合。
 */
type SubmitError = ConflictError | ObserverError;
```

#### 規範

* Bridge の submit() の reject は SubmitError を返さなければならない（MUST）。
* ConflictError は同一 Tick 内の同一 Prop への異値更新を表す（MUST）。
* ObserverError は Strict Observer の例外により Tick が失敗したことを表す（MUST）。
* CommitExecutionError は停止級（fatal）であり、submit() reject 経路に載せてはならない（MUST NOT）。

---

## 6. Bridge Profile（Normative）

**Profile Slot note（Normative）**:
Bridge Profile は独立プロトコルではなく、Bridge 実装が差し替える解決関数群の束である。
Bridge v1.0.0 が要求するのは、必要な解決関数が存在し呼び出せることであり、
Profile 自体の closed set や独立 conformance は規定しない。

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

* 同一 Tick 内で同一 Prop への異値更新が存在する場合、Bridge はそれを conflict として扱い Tick failure を確定しなければならない（MUST）。
* Bridge は当該 Tick を commit してはならない（MUST NOT）。
* Bridge は conflict 解決規則（優先順位・last-write-wins 等）を提供してはならない（MUST NOT）。

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

## D.2 Conflict Detection and Tick Failure（Strict）

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

## D.3 Summary

* Bridge は effect を解釈しない
* Conflict は Tick failure
* StepRecord は決して巻き戻らない

# Appendix E: Tick Lifecycle & Observer Boundary（Normative）

本 Appendix は、Bridge v1.0.0 における **Tick の確定順序および Observer 境界**を規定する。
本 Appendix は **Normative** である。

---

## E.1 Tick Identity and Ordering

Bridge は各 Tick に対して以下を提供しなければならない（MUST）：

* `tick_index: number`
  単調増加する順序キー。
  これは Timeline の整列基準であり、唯一の順序根拠である。

* `tick_id: TickId`
  実装依存の識別子。
  `tick_index` と同一であってもよい（MAY）。

* `execution_id?: string`
  利用可能な場合に提供してよい（MAY）。

### 規範

* `timestamp` は telemetry 用に提供してよい（MAY）。
* `timestamp` を順序決定に使用してはならない（MUST NOT）。
* 観測系（DevTools 等）は `tick_index` を順序基準として扱わなければならない（MUST）。

---

## E.2 Tick Processing Order（Normative）

Bridge は Tick を以下の順序で処理しなければならない（MUST）：

1. **Reservation Phase**
   StepRecord から effect を抽出し、Tick に割り当てる。

2. **Normalization Phase**
   Effect Map を構築し、重複除去・conflict 検証を行う。

3. **CommitPlan Confirmation Phase**
   conflict が存在しないことを確認し、CommitPlan を確定する。
   CommitPlan が確定できない場合、Tick は failure と確定しなければならない（MUST）。

4. **Strict Observer Phase（Pre-Commit）**
   CommitPlan に基づく Effect Map を Strict Observer に通知する。
   Strict Observer 内で例外が発生した場合、Tick は failure と確定しなければならない（MUST）。
   この場合、commit は実行してはならない（MUST NOT）。

5. **Commit Phase**
   CommitPlan を atomic commit する。
   commit 実行中に例外が発生した場合、それは整合性違反であり、通常の submit reject 経路として扱ってはならない（MUST NOT）。

この順序を変更してはならない（MUST NOT）。

---

## E.3 Observer Model（Normative）

Bridge v1.0.0 において、Observer は以下の単一カテゴリとして定義される。

### Strict Observer

Strict Observer は Tick の commit 意味論の一部を構成する観測者である。

* Strict Observer は CommitPlan Confirmation Phase の後、Commit Phase の前に呼び出される（MUST）。
* Strict Observer 内で例外が発生した場合、Tick は failure として確定しなければならない（MUST）。
* Strict Observer failure の場合、commit を実行してはならない（MUST NOT）。
* Strict Observer failure は submit() の reject 経路として伝播されなければならない（MUST）。

Strict Observer は状態生成権限を持たない（MUST NOT modify plan）。

---

## E.4 Observational Guarantees（Normative）

Bridge は以下を保証しなければならない（MUST）：

* Strict Observer は常に「commit 予定として確定した CommitPlan」に基づく更新集合のみを受け取る。
* conflict が存在する場合、Observer は呼び出されない（MUST NOT）。
* Strict Observer は Tick 内の中間状態を観測してはならない（MUST NOT）。
* Strict Observer は部分適用された状態を観測してはならない（MUST NOT）。

---

## E.5 Failure Semantics（Normative）

Tick Failure は以下を意味する：

* CommitPlan は commit されていない。
* 当該 Tick に関連付けられた submit() の Promise は reject される。
* score-fx の StepRecord は変更されない（MUST NOT rollback）。

Failure の原因は次のいずれかである：

1. Conflict 検出
2. Strict Observer 内例外

commit 実行中の例外は recoverable failure ではない。

---

## E.6 Post-Commit Notification（Explicitly Out of Scope）

Bridge v1.0.0 は post-commit 通知を規定しない（MUST NOT require）。

実装は commit 後に Monitoring Observer を提供してよい（MAY）が：

* それは Bridge の意味論に影響してはならない（MUST NOT）。
* Strict Observer と混同してはならない（MUST NOT）。
* Commit 成功／失敗の決定に影響してはならない（MUST NOT）。

Monitoring / DevTools / DOM Adapter は Bridge の外部投影層である。

---

## E.7 DevTools Integration Boundary（Normative）

DevTools は Strict Observer として実装してはならない（MUST NOT）。

DevTools は commit 意味論に影響を与えてはならない（MUST NOT）。

DevTools は Monitoring Observer として実装してよい（MAY）。

DevTools は以下に依存してよい（MAY）：

* `tick_index`
* `tick_id`
* `execution_id`
* `result`

DevTools は以下に依存してはならない（MUST NOT）：

* Effect Map の内部順序
* 内部 merge 手順
* 中間状態

---

# Appendix E — Summary（Revised）

本 Appendix により：

* 通知は **pre-commit のみ**である
* Observer failure は Tick failure である
* commit 中例外は停止級である
* post-commit 通知は仕様外である
* Timeline の順序基準は常に `tick_index` である

---

🔒 **blooky-fx Bridge Specification v1.0.0 — Final / Frozen**

---
