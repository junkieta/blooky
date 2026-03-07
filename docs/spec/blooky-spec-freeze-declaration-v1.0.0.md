# blooky Specifications Baseline Declaration v1.0.0

**Status:** Working Baseline
**Purpose:** リポジトリ内 v1.0.0 文書群の責務境界と依存関係を現実装に合わせて管理する。

---

## 0. Baseline Meaning (Normative)

本リポジトリにおける v1.0.0 は公開 freeze を意味しない。

1. v1.0.0 文書は改変可能である (MAY be revised in place)
2. 改変時は関連仕様との整合を維持しなければならない (MUST)
3. 互換性評価はリポジトリ運用方針に従い、版番号だけで固定しない

---

## 1. Component Map (Normative)

* **score-fx Protocol v1.0.0**
  execution semantics と step 語彙を規定する。

* **blooky Clock Specification v1.0.0**
  tick transaction boundary（merge/conflict/observer/commit/fatal）を規定する。

* **blooky Runtime Submission Contract v1.0.0**
  submit/reject 観測契約と runtime 境界を規定する。

* **blooky-fp / blooky-fv / blooky-context / fxdom**
  それぞれ FRP core、投影、context、DOM 語彙を規定する。

* **blooky-devtools v1.0.0**
  Clock observer 由来の monitoring/projection を規定する。

---

## 2. Dependency Graph (Normative)

* runtime integration depends on score-fx semantics registry and clock
* devtools depends on clock (timeline authority) and projection
* fv depends on fp and runtime submission contract

依存先の語彙を再定義してはならない (MUST NOT)。

---

## 3. Authority Boundaries (Normative)

### 3.1 Ordering Authority

ordering の唯一の根拠は Clock が提供する `tick_index` である (MUST)。

### 3.2 Commit Authority

commit transaction の責務は Clock/runtime にある (MUST)。
projection/devtools/fv/fxdom は commit を制御してはならない (MUST NOT)。

### 3.3 Runtime Integration Boundary

runtime integration は step/effect を submit に写像する実装詳細であり、独立の ordering authority を持たない。

---

## 4. Observer Model (Normative)

observer は pre-commit の conflict-free commit intent を観測する。

* conflict tick では observer を通知しない
* observer 失敗は commit 成否に影響しない
* fatal は通常 reject 経路に載せない

---
