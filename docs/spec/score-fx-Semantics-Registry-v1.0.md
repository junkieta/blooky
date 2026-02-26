# Semantics Registry Specification v1.0

**— Standard Semantics for score-fx —**

**Status:** 🔒 **Final / Frozen**
**Version:** 1.0.0
**Depends on:** score-fx Protocol Specification v1.0.0
**Scope:** Semantics Registry & Standard Vocabulary

---

## 0. Positioning and Intent

**本仕様は、score-fx プロトコル上で使用される「意味論の辞書（Semantics Registry）」である。**

本仕様は、score-fx が提供する **AST + Interpreter モデル**に対し、

* どの `FxNote.kind` が存在しうるか
* それぞれが **Runner にどのような意図を伝えるか**
* どこまでが共通語彙で、どこからが拡張か

を **標準化された形で定義**する。

本書は **設計判断の最終結果のみ**を規定する。
本Registryは、score-fx を中心とする以下の現行仕様群で共有される語彙層として扱う：

* score-fx
* fxdom
* bridge
* devtools
* blooky-fp
* blooky-fv
* runtime submission contract
代替案・歴史的経緯・移行議論は含まない。

---

## 1. Relationship to score-fx

### 1.1 Dependency

本仕様は **score-fx Protocol Specification v1.0.0** を完全に前提とする。

特に以下の前提に依存する：

* `FxScore` / `FxNote` は **純粋な静的データ構造**
* 実行の主権は `Runner` にある
* `Semantics` は **解釈（Interpretation）を行うが、実行は行わない**
* 通信は `SemanticEvent` を介した一方向のみ
* Runner は score-fx プロトコルに従い、
進行を管理し PerformanceStep を生成する唯一の主体である。

### 1.2 Non-goals

本Registryは以下を **一切規定しない**：

* Runner の実装
* Timeline / DevTools / UI
* Transport / Remote Execution
* FRP・UI フレームワークとの接続方法

---

## 2. Semantics Model

### 2.1 Definition

**Semantics** とは、特定の `FxNote.kind` に対して、

> 「この Note が Runner に伝えたい *意味* とは何か」

を定義する **純粋な解釈ルール**である。

Semantics は：

* 状態を保持しない
* Phase（enter / exit 等）を指定しない
* Timeline に直接触れない
* 他の Note を直接駆動しない

### 2.2 One-way Contract

Semantics は `interpret(note, ctx)` の実行中に、
**0 個以上の `SemanticEvent` を yield する**ことで Runner に合図を送る。

Runner はそれを **解釈し、PerformanceStep に変換する唯一の主体**である。

---

## 3. SemanticEvent Model

### 3.1 Minimal Event Set

本仕様 v1.0 において、Semantics が使用できる `SemanticEvent` は
**score-fx Protocol Specification v1.0.0 により定義された最小集合に限定**される。

本仕様は、SemanticEvent の構造や拡張を定義しない。

### 3.2 Resumption Principle

**`resume` は SemanticEvent ではない。**

再開は：

* 外部環境の変化
* `condition` の解消

を **Runner が観測した結果として行う実行管理上の判断**である。

Semantics は再開の瞬間を知らず、知る必要もない。

### 3.3 Condition Opaqueness

`suspend(condition)` に渡される `condition` は
Runner にとって評価可能な **不透明参照（Opaque Reference）**である。

* score-fx / 本Registry は構造を規定しない
* 評価方法は Runner 実装または上位層の合意に委ねられる

### 3.4 Semantics Classification（Informative）

本節は **説明目的（informative）**であり、
**規範的な分類は Section 4 に定義される。**

本Registryが提供する Semantics は、責務により以下の 3 種に分類される：

* Structural Semantics（構造・制御）
* Execution / Boundary Semantics（実行・境界）
* Terminal / Utility Semantics（終端・補助）

---

## 4. Standard Semantics Registry（Normative）

### 4.1 Registry の責務

#### 4.1.1 定義

**Semantics Registry** とは、
score-fx プロトコル上で使用される **`FxNote.kind` とその意味論（Semantics）の対応表**を定義する **意味辞書**である。

Registry は以下を **唯一の責務**とする：

* 許可される `kind` の集合を定義すること
* 各 `kind` が Runner に伝達してよい **意図（SemanticEvent）** を規定すること
* 各 `kind` が要求する `note.data` の最小構造を規定すること

#### 4.1.2 非責務（明確な禁止）

Semantics Registry は、以下を **一切行ってはならない（MUST NOT）**：

* Runner を呼び出す、または制御する
* Timeline / PerformanceStep を直接生成・操作する
* 実行順序・並列性・再開タイミングを決定する
* 外部環境（IO / FRP / Transport）に依存する
* 実装詳細やアルゴリズムを規定する

Registry は **宣言的な辞書**であり、
**実行主体でも、制御装置でもない**。

---

### 4.2 Semantics の基本原則

すべての Semantics 実装は、以下の原則に **必ず従わなければならない（MUST）**。

#### 4.2.1 One-way Contract

* Semantics は `SemanticEvent` を **yield するだけ**である
* Runner はその Event を解釈し、
進行規則に従って PerformanceStep を生成する唯一の主体である。
* Semantics は Runner の判断結果を観測してはならない

#### 4.2.2 非直接実行原則

Semantics は以下を **行ってはならない（MUST NOT）**：

* Step を直接刻む
* suspend / resume / exit を直接発火させる
* 子 Note / 子 Performance を直接駆動する

#### 4.2.3 再開非関知原則

* `resume` は SemanticEvent ではない
* 再開は **condition の解消を Runner / Policy が観測した結果**として行われる
* Semantics は再開の瞬間を知る必要も、知る手段も持たない

---

##### 補助説明（Informative）

**FxScore はプログラムではなく、譜面である。**
Performance は、その譜面に対する *解釈* である。

同一の楽譜から異なる演奏が生まれることが
楽譜の誤りを意味しないのと同様に、
同一の FxScore から異なる Performance が生まれることは、
設計上自然であり、望ましい。

Semantics Registry / score-fx は、
**単一の実行結果を規範化することを目的としない。**
その代わりに、
**構造が正しく提示され、解釈可能であること**を唯一の価値基準とする。

---

### 4.3 SemanticEvent の使用制約

本仕様 v1.0 において、Semantics が使用できる `SemanticEvent` は
**本仕様（Section 4.4）により規定される標準語彙に基づいて制限される。**

Semantics は：

* 標準語彙で許可されていない Event を発行してはならない（MUST NOT）
* 各 kind ごとに許可された Event 以外を発行してはならない（MUST NOT）

---

### 4.4 Standard Semantics Vocabulary（v1.0）

以下は **Semantics Registry v1.0 における標準語彙の完全かつ唯一の一覧**である。

この集合は **closed set** であり、
本バージョンにおいて **追加・削除・再分類は行われない**。

#### 4.4.1 Structural Semantics（構造・制御）

| kind        | 分類       | SubNotes | Semantics が発行してよい Event        | note.data 最小 |
| ----------- | ---------- | -------- | ------------------------------------- | -------------- |
| `sequence`  | Structural | children | `result`（任意）                      | なし           |
| `parallel`  | Structural | children | `result`（任意）                      | なし           |
| `race`      | Structural | children | `result`（任意）                      | なし           |
| `loop`      | Structural | body     | `result`（任意）, `terminate`（任意） | 任意           |
| `condition` | Structural | branches | `result`（then / else のいずれか）    | `test`（ref）  |
| `switch`    | Structural | cases    | `result`（選択された case）           | `key`（ref）   |

**規範：**

* Structural Semantics は **構造的遷移のみ**を宣言する
* 子 Note の選択・順序は 構造（subnotes）で提示する
* 実行・待機・再開の方法は Runner / Policy の責務である

---

#### 4.4.2 Execution / Boundary Semantics（実行・境界）

| kind    | 分類      | SubNotes | Semantics が発行してよい Event | note.data 最小                    |
| ------- | --------- | -------- | ------------------------- | -------------------------------------- |
| `call`  | Execution | ❌ leaf | `result`, `effect`（任意）| `action`（ref）, `input`（ref/serializable） |
| `wait`  | Boundary  | ❌ leaf | `suspend`                 | `until`（opaque condition）             |
| `yield` | Boundary  | ❌ leaf | `suspend`                 | `score`（ref）, `input`（ref）          |

**規範：**

* `yield` は **構造制御ではない**
* 子 Performance は `note.data.score` により **境界越しに指定**される
* `yield` は `getSubNotes()` を用いてはならない（MUST NOT）

---

#### 4.4.3 Terminal / Utility Semantics（終端・補助）

| kind     | 分類     | SubNotes | Semantics が発行してよい Event                   | note.data 最小 |
| -------- | -------- | -------- | ------------------------------------------------ | -------------- |
| `return` | Terminal | ❌ leaf  | `terminate(value)`                              | `value`（ref） |
| `none`   | Utility  | ❌ leaf  | （何も発行しない）/ `result(undefined)`（任意） | なし           |

**規範：**

* `return` は **terminate の宣言**である
* Generator の終了は terminate を意味しない
* terminate を発行しない限り、Performance は終了しない

---

### 4.5 `yield` / `return` に関する規範

#### 4.5.1 `yield` の規範

* yield は、進行が子 Performance に移ることを Runner に通知する。/ 進行の主権自体は常に Runner にある。
* 子 Performance の成否・cancel・値を解釈してはならない（MUST NOT）
* `yield` は suspend を発行するのみである

#### 4.5.2 `return` の規範

* `return` は **現在の Performance を終了させる唯一の標準手段**である
* `return` は `terminate` Event に正規化される
* `return` の使用制約（例：spawn 文脈のみ有効等）は
  **本Registry規範として定義可能**であるが、score-fx プロトコル自体は中立である

---

### 4.6 data / ref / resolve の最小ルール

#### 4.6.1 ref の扱い

* `note.data` に含まれる `ref` は **Semantics により解釈されてはならない（MUST NOT）**
* ref の解決は `PerformanceContext.resolve()` を通じて Runner が行う

#### 4.6.2 opaque data

以下は **opaque** として扱われなければならない：

* `suspend(condition)` の `condition`
* `call.action`
* `yield.score`

Semantics はそれらの構造や評価方法に **一切依存してはならない**。

### 4.6.3 FxCallAction Interface（Normative）

`call` note の `action` が満たすべきインターフェースは以下のとおりである：

```ts
interface FxCallAction<A = void, B = unknown> {
  call(context: Readonly<AppContext>, input: A): B | Promise<B>
}
```

Runner は `action.call(context, input)` の形式で呼び出さなければならない（MUST）。

この呼び出し形式により、以下のいずれも有効なactionとなる：

* **アロー関数**：`this`が束縛済みのため`context`は渡されない。`input`のみを使用する実装に適する。
* **通常関数**：`this`として`context`を受け取る。
* **FxCallActionを実装したオブジェクト**：`call`メソッドで`context`と`input`の両方を明示的に受け取る。

Semantics は`action`の種別を判別してはならない（MUST NOT）。呼び出し形式の統一がその判別を不要にする。

---

### 4.6.4 Outcome Contract（Normative）

本 Registry における実行結果の共通表現を以下とする：

```ts
type Outcome<T> =
  | { kind: "value"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "crash"; error: unknown; source: "action" | "child_boundary" | "runner" | "host" }
  | { kind: "timeout" }
  | { kind: "cancel"; reason?: unknown }
```

#### Emission Constraints（Normative）

`Runner は call の結果として Outcome.kind = value | error | crash | timeout | cancel を返してよい（MAY）。`
`Runner は yield の結果として Outcome.kind = value | crash | timeout | cancel を返してよい（MAY）。`
`Runner は yield において kind:"error" を直接返してはならない（MUST NOT）。`
`yield` における `kind:"timeout"` および `kind:"cancel"` は、
当該親境界の制御結果を表さなければならない（MUST）。
子境界の内部事情（例：子内部の timeout/cancel/error）を
親 `yield` の kind へ昇格してはならない（MUST NOT）。
それらは必要に応じて `kind:"value"` の payload として表現されうる（MAY）。

#### Error/Crash Boundary（Normative）

`kind:"error"` は契約内で返された失敗値を表す。
`kind:"crash"` は契約外の失敗（throw/reject/runner fault 等）を表す。

---

### 4.6.5 ContextRef Compatibility（Informative / Recommended）

score-fx における参照解決は、
ContextRef の解決規則 blooky-context §3.4（decode）および §1.5.1（探索規則） に従うことが望ましい（SHOULD）。

remote 実行で ContextValue を輸送する場合、
Wire 表現は blooky-context Appendix A に従うことが望ましい（SHOULD）。

---

### 4.7 Error is a Value / Crash is Runtime Failure

#### 4.7.1 原則

* Semantics は例外を throw してはならない（MUST NOT）。
* 契約内の失敗は値として表現されなければならない（MUST）。
* Runner は契約外失敗（throw/reject 等）を `Outcome.kind:"crash"` に正規化しなければならない（MUST）。

#### 4.7.2 call / yield の規範

* Runner は call / yield の結果を Outcome として扱う。
* `kind:"error"` は FxCallAction が返した契約内失敗値を表す。
* `kind:"crash"` は Runner が捕捉した契約外失敗を表す。
* Runner は yield において `kind:"error"` を返してはならない（MUST NOT）。
* 子境界の失敗は、必要に応じて `kind:"value"` の payload として表現されうる（MAY）。詳細は §4.6.4 に従う。
* kind の発行制約は §4.6.4 Emission Constraints に従う（MUST）。

---

### 4.8 Event Delivery and Runner Obligations（Normative）

#### 4.8.1 配送順序と完全性

1. Semantics は 0 個以上の `SemanticEvent` を yield してよい（MAY）。
2. Runner は、Semantics が生成した順序どおりにイベントを処理しなければならない（MUST）。
3. Runner は、イベントを並べ替え・欠落・重複させてはならない（MUST NOT）。

#### 4.8.2 `result(value)` の Runner 義務

- Runner は `result.value` を PerformanceStep / ExecutionStep の該当フィールドへ確実に反映しなければならない（MUST）。
- 同一ノート評価で `result` が受理された後、当該評価に追加イベントが存在してはならない（MUST NOT）。

#### 4.8.3 `effect(ref)` の Runner 義務

- Runner は `effect` を即時実行命令として扱ってはならない（MUST NOT）。
- Runner は `effect.ref` を後段で集約可能な形で記録しなければならない（MUST）。

#### 4.8.4 `suspend(until)` の Runner 義務

- Runner は `suspend` を受け取ったら、当該評価を suspended へ遷移させなければならない（MUST）。
- Runner は `phase:"suspend"` 相当の step を記録し、`until` を保持しなければならない（MUST）。
- `until` 成立時、Runner は `phase:"resume"` 相当の step を記録して継続しなければならない（MUST）。

#### 4.8.5 `terminate(value?)` の Runner 義務

- Runner は `terminate` 受理後、以後の subnote スケジューリングを停止し、Performance を終端状態へ遷移させなければならない（MUST）。
- Runner は終端 step（`exit` または `cancel`）を記録し、`value` があれば保持しなければならない（MUST）。
- `terminate` を yield した評価で追加イベントを発行してはならない（MUST NOT）。

#### 4.8.6 排他と例外境界

- 同一ノート評価（および同一 Performance）で `result` と `terminate` を同時に発行してはならない（MUST NOT）。
- Semantics は Runner 境界をまたいで例外（throw）を漏らしてはならない（MUST NOT）。

---

## 5. Compatibility, Versioning & Stability

### 5.1 Version Meaning

* 本仕様は **Semantics Registry v1.0** の最終定義である
* 本仕様は **score-fx 系列の語彙規範**である

---

### 5.2 Responsibility Boundary Declaration

* **score-fx v1.0** は *実行プロトコル* を定義する
* **Semantics Registry v1.0** は *意味論の辞書* を定義する
* 本仕様は **実装を含まない**

---

### 5.3 Frozen Declaration

🔒 **Frozen**

本仕様は今後、

* **後方互換を壊す変更を行わない**
* 語彙の追加は **v1.1 以降**で行う
* 本文の意味論的変更は行わない

---

## 6. Closing Statement


Semantics Registry は、

* 実行エンジンではなく
* UI フレームワークでもなく
* DSL でもない

**score-fx プロトコル上で共有される「意味の辞書」**である。

この再定義により、
Semantics Registry は **拡張可能で、肥大しない中核**として固定された。

---

# 🔒 Semantics Registry v1.0 — Frozen

