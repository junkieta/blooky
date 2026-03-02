# blooky Specifications Freeze Declaration v1.0.0

**Status:** 🔒 Final / Frozen
**Purpose:** v1.0.0 世代の仕様群の境界・依存・互換性ルールを横断的に固定する。

---

## 0. Frozen Meaning (Normative)

freeze とは、v1.0.0 として以下を固定することを意味する（MUST）：

1. 規範（MUST/MUST NOT）の集合が conformance の基準点となる
2. 後方互換を壊す変更は禁止される（MUST NOT）
3. 仕様変更が必要な場合は v1.1+（または v2.0）として別版に分離する（MUST）

---

## 1. Component Map（Normative）

v1.0.0 の主要仕様と責務は以下である。

* **score-fx Protocol v1.0.0**
  実行を「Score と PerformanceStep（事実）」として記述するプロトコル。
  実行制御ではなく、語彙・境界・進行規則を固定する。

* **blooky-fx Bridge v1.0.0**
  StepRecord → Tick → Effect Map → FRP commit を結ぶ。
  Tick ordering の主権を持ち、Atomic commit と conflict 禁止を規定する。

* **blooky Runtime Submission Contract v1.0.0**
  DripPlan の受付、Tick batching、CommitPlan 確定、ObservedPlan(view) 生成、submit 契約を規定する。
  commit-intent（CommitPlan）確定後にのみ observer を呼ぶ。

* **blooky-fp v1.0.0**
  同期 FRP コア。drip で plan を生成し、commit は plan の値更新のみを行う。
  scheduling/timeline/observer を持たない。

* **blooky-fv v1.0.0**
  FRP → DOM 投影と Context 伝搬、Event → submit adapter を規定する。
  commit 意味論を持たず、ObservedPlan(view) を DOM 更新にのみ用いる。

* **blooky-context v1.0.0**
  Context Boundary / ContextRef / ContextValue / Codec（bind/encode/decode）を規定する。
  エラー分類（ENCODE_UNBOUND / DECODE_MISSING_KEY / VALUE_CONSTRAINT）および wire 正規形を固定する。

* **fxdom v1.0.0**
  DOM で score-fx の Score 構造を宣言する要素語彙。
  実行アルゴリズム・effect 適用・tick/commit を規定しない。

* **blooky-devtools v1.0.0**
  Monitoring / Projection。意味論を追加せず、Bridge の ordering に従属する。



---

## 2. Dependency Graph（Normative）

* fxdom v1.0.0 **depends on** score-fx v1.0.0, blooky-context v1.0.0
* blooky-fx Bridge v1.0.0 **depends on** score-fx v1.0.0
* Runtime Submission Contract v1.0.0 **depends on** blooky-fp v1.0.0, Bridge v1.0.0, blooky-context v1.0.0
* blooky-fv v1.0.0 **depends on** blooky-fp v1.0.0, Runtime Submission Contract v1.0.0（interface/view）, blooky-context v1.0.0
* devtools v1.0.0 **depends on** Bridge v1.0.0（ordering: tick_index）および score-fx v1.0.0（語彙参照）, blooky-context v1.0.0

依存先の語彙・境界を再定義してはならない（MUST NOT）。

---

## 3. Authority Boundaries（Normative）

### 3.1 Ordering Authority

* ordering（順序）の唯一の根拠は **Bridge が提供する `tick_index`**である（MUST）。
* devtools/fv/fxdom は順序キーを生成してはならない（MUST NOT）。

### 3.2 Commit Authority

* commit の責務は runtime/bridge にある（MUST）。
* fv/devtools/fxdom は commit を制御してはならない（MUST NOT）。

### 3.3 Effect Interpretation

* effect の意味解釈は Profile/Host にあり、Bridge/DevTools/fxdom は直接解釈しない（MUST NOT）。

---

## 4. Observer Model (Frozen)（Normative）

v1.0.0 の observer 呼び出しは次に固定される：

* **pre-commit のみ**（commit-intent 確定後、commit 実行前）
* observer は **Monitoring-only**（意味論に関与しない）
* observer は **conflict がない CommitPlan を前提**に呼ばれる
* observer の例外は **隔離**され、commit 可否を変更してはならない（MUST NOT）

※ commit 実行中の例外は「recoverable failure」ではなく停止級として扱う、という方針は Bridge/Runtime 各仕様の規範に従う。

---

## 5. Versioning Rule（Normative）

* v1.0.0 の Normative を変更する場合は v1.1+（または v2.0）を作成する（MUST）。
* v1.0.0 のまま許されるのは、意味を変えない明確化・誤字修正・Informative 追記のみ（MAY）。
* 互換性を破る変更は禁止（MUST NOT）。

---

🔒 **END OF blooky Specifications Freeze Declaration v1.0.0**

---