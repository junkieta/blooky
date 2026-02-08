# SemanticEvent 語彙（Normative）

本節は、Semantics が Runner に対して yield できる **SemanticEvent の閉集合（closed set）**を定義する。
Runner は本節の規則に従ってこれらのイベントを解釈しなければならない（MUST）。

## 1. 定義

### 1.1 SemanticEvent とは

**SemanticEvent** は、Semantics がある `FxNote` を解釈する過程で生成する **通知（notification）**である。

* SemanticEvent は **制御命令ではない**（後述）。
* SemanticEvent の種類（kind）は **閉集合**であり、本仕様で定義されたもの以外を追加してはならない（MUST NOT）。

### 1.2 型定義（参考）

```ts
export type SemanticEvent =
  | { type: "result"; value: unknown }
  | { type: "suspend"; until: Prop<boolean> }
  | { type: "effect"; ref: unknown }
  | { type: "terminate"; value?: unknown };
```

---

## 2. 配送と処理モデル

### 2.1 順序

1. Semantics は 0 個以上の SemanticEvent を yield してよい（MAY）。
2. Runner は、Semantics が生成した順序どおりにイベントを処理しなければならない（MUST）。
3. Runner は、イベントを並べ替え・欠落・重複させてはならない（MUST NOT）。

### 2.2 制御命令ではない（重要）

SemanticEvent は、Runner に対して任意の subnote を選択・順序変更させるための命令として解釈されてはならない（MUST NOT）。

* subnote のスケジューリング（sequence/parallel/race 等）は、**Score 構造と Runner の構造規則**によって決まる。
* SemanticEvent は **観測可能な事実の通知**である。

---

## 3. `result(value)`

### 意味

`result` は、当該ノートの意味的な値が **確定した**ことを示す。

### 規則

1. Semantics は、1 つのノート評価に対して `result` を高々 1 回 yield してよい（MAY）。
2. Semantics が `result` を yield した場合、そのノート評価は **完了**とみなされる（MUST）。
3. `result` を yield した後、Semantics は当該ノート評価に関して **追加のイベントを yield してはならない**（MUST NOT）。
   （※ `effect` を出すなら `result` より前に出る必要がある）

### Runner の義務

* Runner は `result.value` を、PerformanceStep / ExecutionStep の該当フィールドへ確実に反映しなければならない（MUST）。

---

## 4. `effect(ref)`

### 意味

`effect` は、Semantics が解釈過程で得た **外部参照（binding / ref）を記録する**ための通知である。

* `effect` 自体は命令ではなく、**事実の記録**である。

### 規則

1. Semantics は任意個の `effect` を yield してよい（MAY）。
2. Runner は `effect` によって **即時に副作用を実行してはならない**（MUST NOT）。
3. `ref` の具体的意味（FxRef への正規化やコミット方式）は、本仕様では規定しない。
   それは Bridge 仕様など上位（または隣接）仕様が規定してよい（MAY）。

### Runner の義務

* Runner は `effect.ref` を、後段で Tick などの単位に集約できる形で **確実に記録**しなければならない（MUST）。
  （実装上はイベント列として保存して defer するのが推奨）

---

## 5. `suspend(until)`

### 意味

`suspend` は、評価を継続できないため **待機状態に入る**ことを示す。

### 規則

1. Semantics は、1 つのノート評価試行に対して `suspend` を高々 1 回 yield してよい（MAY）。
2. `until` は `Prop<boolean>` でなければならない（MUST）。
3. `suspend` は値の確定を意味しない（MUST）。

### Runner の義務

1. Runner は `suspend` を受け取ったら、当該ノート評価を **中断（suspended）**状態に遷移させなければならない（MUST）。
2. Runner は対応する step（例：`phase="suspend"`）を emit/record し、`until` を保持しなければならない（MUST）。
3. `until` が true になったら Runner は評価を再開し、再開 step（例：`phase="resume"`）を emit/record してから継続しなければならない（MUST）。

---

## 6. `terminate(value?)`（Performance-wide）

### 意味

`terminate` は、**この Performance 全体を早期終了する**ことを示す。

* `terminate` は例外ではない。
* `terminate` は構造上の「完了」信号である。

### 規則

1. Semantics は、1 つの Performance に対して `terminate` を高々 1 回 yield してよい（MAY）。
2. `terminate` は **Performance-wide** である（MUST）。
   すなわち、発生時点以降に予定されている実行（subnote の実行を含む）をすべて打ち切り、Performance を終端させる。
3. Semantics は `terminate` を yield した後、追加のイベントを yield してはならない（MUST NOT）。

### `result` との排他（Normative）

* Semantics は、同一ノート評価（および同一 Performance）において `result` と `terminate` を **両方 yield してはならない**（MUST NOT）。
  どちらか一方のみが許可される。

### Runner の義務

* Runner は `terminate` を受け取ったら、以下を行わなければならない（MUST）：

  1. 以後の subnote スケジューリングを停止する
  2. Performance を終端状態へ遷移させる
  3. 最終 step（例：`phase="exit"` あるいは `phase="cancel"`）を emit/record し、`value` があればそれを保持する
  4. Timeline の不変条件（順序・重複・欠落等）を破ってはならない

---

## 7. エラー方針（境界規範）

Semantics は Runner 境界をまたいで例外（throw）を漏らしてはならない（MUST NOT）。
内部エラーがある場合は、仕様が定める **値としての失敗表現**に落とし込むか、`terminate` を用いて制御された終端として表現しなければならない（MUST）。

---

