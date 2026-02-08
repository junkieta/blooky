# Structural Progression Rules（構造進行規則 / Normative）

## 0. 目的

本章は、Score の構造（subnotes を含むノート木）を **Runner がどのように進行（progression）として解釈するか**を定義する。
ここで定義されるのは **実行の外形（いつ子を開始し、いつ親が完了するか）**のみであり、各ノートの意味内容（Semantics の内部ロジック）や FRP/Bridge の詳細は対象外とする。

> この章が必要なのは、SemanticEvent を「制御命令ではない」と定義した結果、
> **進行の主権が Runner＋構造に完全に移った**ためである。

---

## 1. 共通定義

### 1.1 ノートの状態（Normative）

Runner は各ノートに対して、少なくとも以下の状態遷移を扱わなければならない（MUST）。

* **未開始（not-started）**
* **進行中（running）**
* **待機中（suspended）**
* **完了（completed）**
* **中止（cancelled）**

※ 内部表現は任意。ただし観測（Timeline/PerformanceStep）上は区別できる必要がある。

### 1.2 完了（completion）の定義（Normative）

ノートは、以下のいずれかで **完了（completed）**とみなされる（MUST）。

1. Semantics が `result(value)` を yield し、Runner がそれを受理した
2. Semantics が `terminate(value?)` を yield し、（本仕様が定義するスコープで）Performance が終端した
3. Runner が本章の構造規則に従って「完了した」と判定した

   * 例：sequence の親が、子ノートをすべて完了させた

> 注：`terminate` は Performance-wide（Performance 全体の終端）であり、個別ノート完了の一般手段ではない。

### 1.3 排他（Normative）

同一ノート評価において、Semantics は `result` と `terminate` を両方 yield してはならない（MUST NOT）。
（あなたの方針どおり排他に固定）

### 1.4 例外の禁止（境界規範 / Normative）

Semantics は Runner 境界をまたいで throw を漏らしてはならない（MUST NOT）。
Runner も境界外へ throw を漏らさないことが推奨される（SHOULD）。
（値としての失敗表現は別章/別仕様で規定してよい）

---

## 2. subnotes の開始規則（共通）

### 2.1 開始権限（Normative）

Runner は、親ノートの構造規則が許すタイミングでのみ子ノート（subnote）を開始してよい（MUST）。
SemanticsEvent は子ノートの開始順序・選択を指示する命令として解釈してはならない（MUST NOT）。

### 2.2 再入（Normative）

同一ノートを重複して開始してはならない（MUST NOT）。
（loop 等で再実行する場合は「新しい評価インスタンス」として扱うか、Runner の管理下で再入を明示的に区別する）

---

## 3. 構造ノートごとの進行規則（最小）

> ここでは **最小の外形**だけを書く。
> “いつ開始するか / いつ完了するか / terminate/cancel が来たらどうするか” のみ。

### 3.1 `sequence`（順次実行）

**開始**

* `sequence` の開始時、Runner は最初の子ノートを開始する（MUST）。

**進行**

* ある子ノートが完了したら、Runner は次の子ノートを開始する（MUST）。
* いずれかの子が `suspend` で待機に入った場合、Runner はその待機解除まで `sequence` の進行を停止する（MUST）。
  （待機解除後、同じ子から再開する）

**完了**

* 全ての子ノートが完了した時点で、`sequence` 自身は完了とみなされる（MUST）。
* `sequence` の `result` 値をどうするかは、プロファイルで定義してよい（MAY）。
  （例：最後の子の result を採用、配列で集約、void 等）

### 3.2 `parallel`（並列実行）

**開始**

* `parallel` の開始時、Runner は全ての子ノートを開始してよい（MAY）。
  ただし開始順は規定しない。

**完了**

* `parallel` の完了条件はプロファイルで選択できるが、少なくとも次のいずれかを明示しなければならない（MUST）：

  * 全子完了で完了（all-of）
  * 任意一子完了で完了（any-of）
* score-fx 本体としての推奨は **all-of**（SHOULD）。
  （race を別に持つなら parallel は all-of が読みやすい）

**待機**

* いずれかの子が `suspend` の場合でも、他の子の進行は妨げない（MUST）。

### 3.3 `race`（最初に終わったものが勝つ）

**開始**

* `race` の開始時、Runner は全ての子ノートを開始してよい（MAY）。

**勝者決定**

* 最初に **完了**した子ノートを勝者とする（MUST）。

  * 完了とは 1.2 に定義した completed を指す（result による完了が基本）

**残りの扱い**

* 勝者が決定した時点で、Runner は残りの子ノートを中止（cancel）しなければならない（MUST）。
  （中止理由や CancelToken の詳細は別章/別仕様でよい）

**race 自身の完了**

* 勝者決定と同時に `race` は完了とみなされる（MUST）。

### 3.4 `loop`（反復）

loop は “反復する構造” を提供するが、反復条件はプロファイルに委ねる。score-fx としての最小規範は以下。

**開始**

* `loop` の開始時、Runner は本体ノート（body）を開始する（MUST）。

**反復**

* 本体ノートが完了した時点で、Runner は次の反復を開始してよい（MAY）。
  反復の停止条件はプロファイルで規定する（MUST）。
  （例：回数、条件、外部キャンセル等）

**完了**

* 停止条件が満たされた時点で loop は完了とみなされる（MUST）。

> 注：loop の “break/continue 的な局所終端” を `terminate` で表現してはならない（MUST NOT）。terminate は Performance-wide のみ。

### 3.5 `condition` / `switch`（分岐）

ここが最も重要です。「Semantics が選ぶ」路線を捨てた場合、**選択は構造で決める**必要があります。

**開始**

* Runner は condition/switch が要求する “選択決定値” を得た後、対応する子ノートを開始する（MUST）。

**選択決定値の取得**

* 選択決定値の取得方法はプロファイルに委ねる（MUST）。
  典型例：

  * 直前ノートの `result` を入力として使う
  * AppContext 等の参照から得る
  * ルート引数から得る

**選択の規範**

* 選択が確定したら、Runner は選ばれた 1 つ（または規定個数）の子ノートのみを開始しなければならない（MUST）。
* 選ばれなかった子ノートは開始してはならない（MUST NOT）。

---

## 4. `suspend` と再開（resume）

### 4.1 `suspend(until)` の opaque 化（Normative）

`suspend.until` の型は `ConditionRef`（opaque）である。
ConditionRef の評価方法（真偽判定・購読・ポーリング等）は **プロファイル**が定義する。

### 4.2 Runner の義務（Normative）

* Runner は `suspend` を受け取ったら、該当ノートを suspended に遷移させる（MUST）。
* Runner は ConditionRef が “成立”したと判断したら、ノートを running に戻し、再評価を継続する（MUST）。
* `resume` は SemanticEvent ではなく Runner が Timeline 上の step として刻む（MUST）。
  （step の厳密な種類名は本仕様の step 定義に従う）

---

## 5. `terminate`（Performance-wide）

### 5.1 意味（Normative）

`terminate` は **Performance 全体を早期終了**させる通知である。
Runner は `terminate` を受け取ったら、以後の subnote スケジューリングを停止し、Performance を終端しなければならない（MUST）。

### 5.2 伝播（Normative）

`terminate` は局所スコープに閉じてはならない（MUST NOT）。
（region termination を設けない）

---

## 6. これ以上を score-fx に入れない（境界宣言）

本章は以下を規定しない（MUST NOT imply）：

* FRP（Prop/Stream）の計算規則や atomic commit（Tick）
* effect の適用単位（Bridge の責務）
* Semantics の内部意味論（blooky-fx registry の責務）
* DevTools/UI の投影

