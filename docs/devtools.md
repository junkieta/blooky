# blooky-devtools Specification v1.0.0

**Subtitle:** Monitoring & Projection Contract for blooky-fx Bridge
**Status:** Draft (Freeze Candidate)
**Depends on:**

* score-fx Protocol Specification v1.0.0
* blooky-fx Bridge Specification v1.0.0 (including Appendix E)
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

DevTools は Bridge Specification v1.0.0 Appendix E に従属する（MUST）。

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

## 3. Tick Monitoring Contract（Normative）

### 3.1 Observed Payload

DevTools は Bridge が提供する以下の情報を観測してよい（MAY）：

* `tick_index`
* `tick_id`
* `execution_id`（存在する場合）
* `result: "success" | "failure"`
* `effects_summary`

DevTools は Effect Map の内部順序や中間状態に依存してはならない（MUST NOT）。

---

### 3.2 Lifecycle Boundary

DevTools が観測できるのは以下のみ：

* Tick Commit 成功後
* Tick Failure 確定時

Reservation / Merge 等の内部段階を観測してはならない（MUST NOT）。

---

### 3.3 Ordering

DevTools は表示順を `tick_index` に基づいて整列しなければならない（MUST）。

timestamp を順序決定に使用してはならない（MUST NOT）。

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

### 4.3 Injection Model（Dynamic Extends）

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

## 8. Failure Handling

DevTools 内の例外は：

* Commit 成否を変更してはならない（MUST NOT）
* 可能であれば隔離されるべきである（SHOULD）

Tick failure は Bridge が確定させる。

---

## 9. Conformance

実装が v1.0.0 準拠であるためには：

1. Bridge Appendix E に従属する
2. tick_index を順序基準とする
3. Injection による意味論変更を行わない
4. DevTools 無効時に挙動が一致する

---

## Closing Statement

blooky-devtools v1.0.0 は、

* Timeline 主権を Bridge に固定し
* Strict Policy を維持し
* DevTools を安全な Monitoring Observer として定義し
* done を最小化し
* 将来拡張（Bus / Fact 正規化）を可能にする

最小核の固定である。

---
