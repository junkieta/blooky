# blooky-devtools Specification v1.0.0

**Subtitle:** Monitoring & Projection Contract for blooky-bridge
**Status:** 🔒 Final / Frozen
**Depends on:**

* score-fx Protocol Specification v1.0.0
* blooky-bridge Specification v1.0.0 (including Appendix E)
  **Scope:** Monitoring / Projection / Dev-only Injection
  **Non-goal:** Execution control, Timeline ownership, Ordering semantics

---

## 0. Purpose and Positioning

本仕様は、blooky ファミリーにおける実行・Commit・FRP 連動を
**意味論を追加せずに可視化するための Monitoring / Projection 契約**を定義する。

DevTools は以下のみを行う：

1. Bridge が確定させた Tick を観測する
2. 観測結果を DOM / Graph 等へ投影する
3. 開発時のみ有効な拡張注入を提供する

DevTools は以下を行ってはならない（MUST NOT）：

* Timeline を定義する
* ordering を決定する
* effect を解釈する
* 実行意味論を追加する

Timeline の唯一の主権は Bridge にある。

---

## 1. Normative Language

MUST / MUST NOT / SHOULD / SHOULD NOT / MAY は RFC 2119 に従う。

---

## 2. Design Principles（Normative）

### 2.1 Bridge Subordination

DevTools は blooky-bridge Specification v1.0.0 Appendix E に従属する（MUST）。

* `tick_index` は唯一の順序基準である
* DevTools は順序キーを生成してはならない（MUST NOT）
* DevTools は ordering を再定義してはならない（MUST NOT）

---

### 2.2 Monitoring Only

DevTools は Monitoring Observer として実装される（MUST）。

* Commit Observer の一部になってはならない（MUST NOT）
* DevTools の例外は Tick 成否を変更してはならない（MUST NOT）

---

### 2.3 Zero-Modification Integration

DevTools は本番コードを変更せず導入できなければならない（MUST）。

* import / build switch により有効化される
* prod ビルドでは存在しない

---

### 2.4 Semantic Invariance

DevTools は実行意味論に影響してはならない（MUST NOT）。

* effect 解釈禁止
* Phase 遷移への介入禁止
* Conflict 処理禁止

---

# 3. Tick Monitoring Contract（Revised / Normative）

## 3.1 Observed Payload（Normative）

DevTools は、Bridge/Adapter が提供する以下の情報を観測してよい（MAY）：

* `tick_index`
* `tick_id`
* `execution_id`（存在する場合）
* `effects_summary`
  （当該 Tick で **commit 予定**の更新集合に関する summary。
   summary の生成方式・粒度は実装依存でよい。）

DevTools は以下に依存してはならない（MUST NOT）：

* Effect Map の内部順序
* 内部 merge 手順
* 中間状態

**Normative note**：
本仕様は Tick の success/failure（結果通知）を要求しない。
結果通知が必要な場合は Adapter 層の拡張として定義されうるが、
DevTools v1.0.0 の依存関係には含めない。
また、停止級（fatal）は Bridge/Runtime の停止経路で扱われるものであり、
DevTools の通知語彙として recoverable failure と同列に扱ってはならない（MUST NOT）。

---

## 3.2 Lifecycle Boundary（Normative）

DevTools が観測できるのは、次の条件を満たす Tick に限られる：

* conflict が存在しないことが確定している
* commit 予定の更新集合（Effect Map / ObservedPlan 相当）が確定している
* commit 実行前（pre-commit）

DevTools は以下を観測してはならない（MUST NOT）：

* Reservation / merge / conflict 検証の途中状態
* commit 実行中の状態

Bridge v1.0.0 は post-commit 通知を要求しない（MUST NOT require）。

---

## 3.3 Ordering（Unchanged / Normative）

DevTools は表示順を `tick_index` に基づいて整列しなければならない（MUST）。

`timestamp` を順序決定に使用してはならない（MUST NOT）。

---

## 4. FxDOM Projection（Normative）

DevTools は Tick 観測結果を FxDOM 要素へ投影してよい（MAY）。

### 4.1 Binding

FxNote と FxDOM Element の関連付けは外部テーブルで保持する（SHOULD）。

* WeakMap を使用することが推奨される
* FxNote 構造へ情報を埋め込んではならない（MUST NOT）

---

### 4.2 Projection Channels

許可される投影チャネル：

* CustomStateSet（states.add/delete）
* data-* 属性
* CSS variables
* ShadowRoot 内の補助表示

実行意味論に影響する DOM 変更を行ってはならない（MUST NOT）。

---

### 4.3 Context Visualization（Informative）

devtools は ContextKey が symbol である場合、
Host が提供する表示名または Symbol.keyFor に基づく文字列表現を用いることが望ましい（SHOULD）。

---

### 4.4 Injection Model（Dynamic Extends）

DevTools は FxDOM 要素を extends してよい（MAY）。

ただし：

* define 前に差し替える（MUST）
* super.* を呼び出す（MUST）
* toFxNote の意味を変更しない（MUST NOT）
* アプリコードの変更を要求しない（MUST）

---

## 5. FRP Graph Monitoring（Optional）

DevTools は FRP 伝播を観測してよい（MAY）。

ただし：

* FRP 再計算をトリガしてはならない（MUST NOT）
* merge / map の意味論に介入してはならない（MUST NOT）

Graph 表示は Informative 機能であり、v1.0.0 では規範化しない。

---

## 6. DOM Adapter Interaction（Normative Boundary）

Bridge は DOM 投影を規定しない。

DOM イベント（例：`blooky-collapse-*`）は Adapter 層の責務である。

DevTools はこれらのイベントを観測してよい（MAY）。

ただし：

* DOM イベントは Bridge の ordering を上書きしてはならない（MUST NOT）
* DOM event timestamp を順序根拠にしてはならない（MUST NOT）

---

## 7. done の扱い（Minimal）

done は「戻り値確定の通知口」として扱われる。

* done は副作用適用先ではない（MUST NOT）
* done に意味論を追加してはならない（MUST NOT）
* done を汎用フックに拡張する設計は推奨されない（SHOULD NOT）

本仕様では done の内部構造を規定しない。

---

# 8. Failure Handling（Normative）

DevTools 内の例外は：

* commit 成否を変更してはならない（MUST NOT）
* commit 実行を中断させてはならない（MUST NOT）
* submit() の resolve/reject を変更してはならない（MUST NOT）
* 可能であれば隔離されるべきである（SHOULD）
* DevTools Observer は同期観測として扱われ、戻り値を await してはならない（MUST NOT）
* Promise rejection 等の非同期失敗は診断として収集してよいが、commit/submit 成否に影響させてはならない（MUST NOT）

**Normative note**：
Tick failure の確定および error の生成は Bridge/Runtime の責務である。
DevTools は failure を自ら確定させてはならない（MUST NOT）。
CommitExecutionError 相当の停止級（fatal）も同様に Bridge/Runtime の責務であり、
DevTools はこれを通常の submit() reject として扱ってはならない（MUST NOT）。

---

# 9. Conformance（Minor Clarification）

実装が v1.0.0 準拠であるためには：

1. Bridge Appendix E（pre-commit Monitoring 境界）に従属する
2. `tick_index` を唯一の順序基準とする
3. Injection による意味論変更を行わない
4. DevTools 無効時に挙動が一致する
5. commit 成否に影響を与えない

---

# 10. Frozen Declaration（Normative）

🔒 **Frozen**

* v1.0.0 は blooky-devtools の基準点である。
* 後方互換を壊す変更は禁止（MUST NOT）。
* 意味論変更は v1.1+ で行う（MUST）。
* v1.0.0 のまま許されるのは、意味を変えない明確化・誤字修正・Informative 追記のみ（MAY）。

---

## Closing Statement

blooky-devtools v1.0.0 は、

* Timeline 主権を Bridge に固定し
* DevTools を pre-commit の Monitoring Observer として定義し
* DevTools の失敗を commit 成否から隔離し
* Injection による意味論変更を禁止し
* 将来拡張（可観測バス／Fact 正規化）を可能にする

最小核の固定である。

---
