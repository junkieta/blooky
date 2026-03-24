# blooky Projection Specification v1.0.0 (Draft)

**Subtitle:** Monitoring & Visualization Contract for Clock Observability
**Status:** Draft

---

## 0. Purpose and Scope

本仕様は、blooky runtime における **Clock / Runtime の観測結果を、意味論を追加せずに可視化するための Projection 契約**を定義する。

Projection は以下のみを行う。

1. Clock が確定させた Tick 観測を受け取る
2. commit 観測を DOM / Graph / FxDOM / Canvas / 3D view 等へ投影する
3. 開発用・検査用の視覚補助を提供する

Projection は以下を行ってはならない (MUST NOT)。

* Timeline を定義する
* ordering を再定義する
* commit 意味論を変更する
* effect を解釈する
* conflict を解決する
* runtime state を捏造する

Projection は **Clock に従属する観測層**である。

---

## 1. Normative Language

MUST / MUST NOT / SHOULD / SHOULD NOT / MAY は RFC 2119 に従う。

---

## 2. Design Principles

### 2.1 Clock Subordination

Projection は Clock が提供する Tick / Commit 観測に従属しなければならない (MUST)。

* `tick_index` は唯一の順序基準である
* Projection は順序キーを生成してはならない (MUST NOT)
* Projection は ordering を再定義してはならない (MUST NOT)

### 2.2 Monitoring Only

Projection は Monitoring Observer として実装されなければならない (MUST)。

* commit を発生させてはならない (MUST NOT)
* plan を書き換えてはならない (MUST NOT)
* Projection の例外は Tick 成否を変更してはならない (MUST NOT)

### 2.3 Semantic Invariance

Projection は実行意味論に影響してはならない (MUST NOT)。

* effect 解釈禁止
* conflict 処理禁止
* phase / transition 介入禁止
* runtime scheduling 介入禁止

### 2.4 Failure Isolation

Projection failure は隔離されなければならない (MUST)。

* Observer failure は commit execution に影響してはならない
* 一部 projection の失敗は他の projection を巻き込んではならない (MUST NOT)

---

## 3. Projection Sources

Projection は次の観測源を入力としてよい (MAY)。

1. `ObservedTick`
2. `ObservedCommitPlan`
3. FxRuntime / Execution 由来の execution step 観測
4. FRP graph metadata
5. DOM / FxDOM binding metadata

Projection は、Clock が確定していない中間状態を入力としてはならない (MUST NOT)。

---

## 4. Projection Targets

Projection は次の可視化対象を提供してよい (MAY)。

* Timeline Projection
* Graph Projection
* DOM Projection
* FxDOM Projection
* Canvas / 3D Overlay Projection
* Log / Inspector Projection

Projection target は **view** であり、runtime の権威的状態ではない。

---

## 5. Timeline Projection

Timeline Projection は Clock Tick を基準に構築される。

* Timeline の唯一の順序基準は `tick_index` である
* Timeline は `ObservedTick` から導出される
* Projection は独自の順序基準を導入してはならない (MUST NOT)

Timeline Projection は commit 意味論を持たない。

---

## 6. Commit Projection

Commit Projection は `ObservedCommitPlan` または `ObservedTick.effects_summary` を view として投影する。

Projection は次を満たさなければならない (MUST)。

* commit 済みまたは pre-commit 確定済みの観測のみ扱う
* plan の編集権限を持たない
* conflict 発生 Tick を成功状態として表示してはならない (MUST NOT)

---

## 7. DOM / FxDOM Projection

Projection は runtime 観測を DOM / FxDOM 表現へ投影してよい (MAY)。
Projection の DOM / FxDOM 表示は、以下を満たさなければならない (MUST)。

* DOM / FxDOM 表現のみを更新する
* commit を発生させない
* Prop / Stream / Clock state を変更しない
* runtime ordering を変更しない

---

## 8. Event Projection

Projection は runtime 観測の結果を外部イベントへ投影してよい (MAY)。

例:

* debug overlay update
* DOM CustomEvent
* inspector refresh
* external logger sink

ただしこれらは外部投影であり、runtime 契約の一部ではない。
`runtime.submitPlan` の結果を DOM CustomEvent へ投影する挙動は外部投影であり、本仕様の規範対象ではない。

---

## 9. FxRuntime / Execution Step Projection

Projection は FxRuntime または Execution 由来の execution step を補助表示に利用してよい (MAY)。

ただし、これらは Timeline authority を持たない。
Timeline authority は Clock Tick にのみある。

Execution step は **execution overlay** として扱うのが望ましい (SHOULD)。

---

## 10. Non-Goals

Projection は以下を提供しない。

* execution control
* pause / resume / step execution
* commit / conflict 解決
* plan rewriting
* rollback
* runtime ownership
* effect interpretation

これらは Clock / score-fx / DevTools の責務である。

---

## 11. Conformance

Projection 実装が本仕様に適合するためには、少なくとも次を満たさなければならない。

1. Clock ordering に従属する
2. semantics を変更しない
3. observer failure を commit 成否から隔離する
4. view を権威的状態として扱わない
5. runtime state を編集しない

---

## 12. Implementation Notes (Non-Normative)

Projection の典型構成は次のとおりである。

```text
Clock observers
   ↓
Projection adapters
   ├ Timeline view
   ├ Graph view
   ├ DOM / FxDOM overlay
   ├ Canvas / 3D overlay
   └ Inspector / logger
```

---

## 13. Relationship to DevTools

DevTools は Projection を利用する debug runtime である。

Projection 自体は execution control を持たない。
pause / resume / step / inspect のような制御面は DevTools 側で規定される。

---
