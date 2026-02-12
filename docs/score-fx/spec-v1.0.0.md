# score-fx Protocol Specification v1.0.0

**Project Name:** score-fx
**Version:** 1.0.0 (Score & Performance Edition)
**Status:** 🔒 **Final / Frozen**

---

## 0. Purpose and Scope

本仕様は、非同期実行を「譜面（Score）」と「演奏（Performance）」として記述し、演奏過程を **時間軸上に確定していく事実（PerformanceStep）の列**として扱うための **実行記述プロトコル**を定義する。

本仕様が規定するのは次の最小集合のみである：

1. Score（静的構造）を演奏する際に発生する **事実（PerformanceStep）** の型と順序
2. Runner と Semantics の境界契約（通知語彙、throw 禁止、suspend/resume の責務分離）
3. 構造ノート（sequence/parallel/race/loop/condition/switch）の **進行規則**

本仕様は、キーワード **MUST, MUST NOT, SHOULD, SHOULD NOT, MAY** を **RFC 2119** の定義に従って解釈する。

---

## 1. Overview

**score-fx** は、非同期実行の構造を **譜面（Score）**、その過程を **演奏（Performance）** として定義する実行記述プロトコルである。

score-fx は実行を「命令の逐次適用」としてではなく、**時間軸上に確定していく事実（PerformanceStep）の記録**として扱う。

同一の Score から異なる Performance が生じうることを前提とし、それらを **同一の構造に対する異なる演奏**として扱う。

本仕様では **FxNote を Note と略記**してよい。
また、構造ノートの子要素を **subnote（子ノート）**と呼ぶ。

---

## 2. Terminology（命名定義）

| 用語                  | 定義       | 役割                                                               |
| ------------------- | -------- | ---------------------------------------------------------------- |
| **FxNote（Note）**    | 実行の小単位   | 譜面上の記譜点                                                          |
| **FxScore**         | 実行の構造定義  | Note からなる静的譜面                                                    |
| **Performance**     | 演奏空間     | 固有の `execution_id` を持つ実行ドメイン                                     |
| **PerformanceStep** | 実行の事実    | 演奏中に確定した不変の出来事                                                   |
| **Timeline**        | 時間軸（概念）  | 演奏時間の進行そのもの                                                      |
| **StepRecord**      | 事実列（実体）  | PerformanceStep の順序列（保存・配送されうる）                                  |
| **Playhead**        | 現在境界（概念） | 確定（Stepが存在）と未確定可能性を分ける概念境界                                       |
| **Runner**          | 実行主体     | 譜面を演奏し、事実を刻む存在                                                   |
| **Semantics**       | 意味論      | Note を解釈し、合図（SemanticEvent）を送る                                   |
| **Profile** | 拡張契約 | 実装が差し替える解決関数群の束。独立プロトコルではない。score-fx が要求するのは必要な解決関数の存在のみであり、Profile 自体の closed set / 独立 conformance は規定しない。 |

**Normative note:** Timeline は StepRecord と同一ではない。Timeline は概念、StepRecord は実体である。

---

## 3. Core Data Structures（Normative）

### 3.1 PerformanceStep

PerformanceStep は演奏中に発生した **不変の事実**である。

```ts
type PerformanceStep = {
  phase: PerformancePhase;
  note_id: string;
  execution_id: string;

  // Ordering
  step_index: number;     // MUST be monotonic within execution_id

  // Optional wall-clock / telemetry
  timestamp?: number;     // MAY be present; semantics are informative

  // Extensible payload/effect
  payload?: unknown;      // extensible, opaque to score-fx
  effect?: unknown;       // EffectBinding (opaque)
};
```

* **順序の規範**は `step_index` によって規定される（§4.5）。
* `timestamp` は任意であり、実時刻である必要はない（informative）。本仕様の conformance は `timestamp` に依存しない。

### 3.2 PerformancePhase

```ts
type PerformancePhase =
  | "enter"
  | "active"
  | "suspend"
  | "resume"
  | "exit"
  | "cancel";
```

* `resume` は **SemanticEvent ではない**。Runner が観測結果として記録する（MUST）。
* `cancel` は Performance-wide の中止として扱う（§4.4）。

---

## 4. Operational Rules（Normative）

### 4.1 Staticity of Score

FxScore は静的な設計図であり、演奏中に書き換えられてはならない（MUST NOT）。
Runner は Score を読み取り専用として扱わなければならない（MUST）。

### 4.2 Effect Binding（opaque）

`effect` は副作用そのものではなく、**外部世界への参照情報**である。
score-fx は `effect` の形式・意味解釈・適用方式・適用単位を規定しない（MUST NOT）。

* Semantics が `SemanticEvent.effect` を emit してよい（MAY）。
* Runner はそれを任意の Step に反映してよい（MAY）。どの phase に付与するかは **Profile** が定義してよい（MAY）。

### 4.3 Error-to-Value Mapping

例外（throw）は境界を越えて漏れてはならない（MUST NOT）。

* Semantics は Runner 境界をまたいで throw を漏らしてはならない（MUST NOT）。
* Runner も外部へ throw を漏らさないことが推奨される（SHOULD）。

失敗は **値**として `payload` に表現される。
ただし `payload` は opaque であるため、score-fx は「成功／失敗」を判定しない（MUST NOT）。

### 4.4 Cancellation（Performance-wide）

外部要因により Performance が cancel された場合：

1. Runner は `phase:"cancel"` の Step を StepRecord に記録しなければならない（MUST）。
2. Runner はすべての Sub-Performance に cancel を伝播させなければならない（MUST）。
3. cancel 後に生成される Step は無視される設計が推奨される（SHOULD）。ただしログ収集目的で記録することは妨げない（MAY）。

### 4.5 Step Ordering（因果順序）

同一 `execution_id` の StepRecord は次を満たさなければならない（MUST）：

* `step_index` は単調増加である（MUST）。
* 同一 `note_id` の phase 列は §8 の状態・進行規則と矛盾してはならない（MUST NOT）。

### 4.6 terminate と cancel の関係（Normative）

`terminate` と `cancel` は **別概念**である：

* `terminate` は **Semantics → Runner** の通知であり、**正常系の早期終端（Performance-wide）**を表す。
* `cancel` は **外部要因の中止**および中止伝播の手段である。

Runner が `terminate` を受理した場合：

1. Runner は当該 Performance を **終端状態**へ遷移させ、以後の subnote スケジューリングを停止しなければならない（MUST）。
2. Runner は終端を StepRecord に表現しなければならない（MUST）。その表現は次のいずれか：

   * (A) **`phase:"exit"`** の Step を、終端ノート（どの note_id とするかは Profile）に対して記録する
   * (B) **`phase:"cancel"`** を記録してよい（MAY）
     ※ v1.0.0 は「terminate＝cancel と同一視」を要求しない（MUST NOT）。
3. Sub-Performance の扱いは Profile が定義する（MUST）。ただし、**terminate を子に“自動伝播”してはならない**（MUST NOT）。必要なら cancel（§4.4）を用いる。

Sub-Performance が `terminate` した場合：

* 親 Performance は自動的に terminate しない（MUST NOT）。親がどう扱うか（結果として terminate する／継続する／cancel する）は **構造規則または Profile** に委ねる（MAY）。

---

## 5. Timeline and Projection Model

### 5.1 Timeline（Normative）

Timeline とは Performance における **演奏時間の進行を表す一次元の時間軸（概念）**である。
Timeline はログではない（Normative）。

### 5.2 Playhead（Informative）

Playhead は Timeline 上で「確定（Step が存在）／未確定可能性」を分ける概念境界である。
Playhead は Step として表現されない（Normative ではなく informative な設計原則）。
UI が Playhead を描画することは Projection の責務である。

### 5.3 PerformanceStep と確定性（Normative）

確定性は **Step の存在によってのみ判断**される（MUST）。
score-fx は「確定領域」「未確定領域」などの名前付き Region を内部概念として持たない（MUST NOT）。

### 5.4 Projection（Informative）

Projection は Timeline（概念）と Score（構造）と StepRecord（事実列）を入力として実行状況を可視化する View である。
色・形・レイヤー・領域分割はすべて Projection の責務である。

---

## 6. Observability（Normative）

Runner は Step を観測者に通知してよい（MAY）。
観測は制御に使われてはならない（SHOULD NOT）。
通知方式（同期/非同期、push/pull、永続化、再送、順序保証など）は規定しない。

---

## 7. SemanticEvent Vocabulary（Normative）

SemanticEvent は Semantics → Runner の **一方向通知**である。
SemanticEvent は **制御命令ではない**（MUST NOT interpret as control command）。

### 7.1 Closed Set（Normative）

```ts
type SemanticEvent =
  | { type: "result"; value: unknown }
  | { type: "effect"; ref: unknown }
  | { type: "suspend"; until: unknown }
  | { type: "terminate"; value?: unknown };
```

### 7.2 `result`（Normative）

* 同一ノート評価に対し高々 1 回（MUST NOT emit more than once）。
* `result` の後に追加イベントを emit してはならない（MUST NOT）。

### 7.3 `effect`（Normative）

* 外部参照（opaque）の通知。
* Semantics は副作用を実行してはならない（MUST NOT）。

### 7.4 `suspend`（Normative）

* `until` は opaque。
* 評価方法（購読、ポーリング、真偽判定など）は Profile が定義する（MUST）。

### 7.5 `terminate`（Normative）

* Performance-wide の早期終端通知。
* `result` と排他（MUST NOT emit both in the same evaluation）。

---

## 8. Structural Progression Rules（Normative）

### 8.1 原則（Normative）

* 進行の主権は Runner にある（MUST）。
* SemanticEvent は subnote の開始順序・選択を指示する命令として解釈してはならない（MUST NOT）。
* Runner は構造規則が許すタイミングでのみ subnote を開始してよい（MUST）。
* 同一ノート評価を重複して開始してはならない（MUST NOT）。

### 8.2 ノート状態と Phase の対応（Normative）

Runner は各ノート評価を次の状態として区別できなければならない（MUST）：

* not-started / running / suspended / completed / cancelled

状態と Phase の対応は次の通り（Normative）：

| State       | Allowed Phases                | Next State                        |
| ----------- | ----------------------------- | --------------------------------- |
| not-started | enter                         | running                           |
| running     | active, suspend, exit, cancel | suspended / completed / cancelled |
| suspended   | resume, cancel                | running / cancelled               |
| completed   | (none)                        | terminal                          |
| cancelled   | (none)                        | terminal                          |

**追加規範：**

* `enter` は当該ノート評価につき高々 1 回（MUST NOT duplicate）。
* `exit` と `cancel` は終端 Phase であり、以後そのノート評価に対して Phase を記録してはならない（MUST NOT）。

### 8.3 Completion（Normative）

ノートは次のいずれかで完了とみなされる（MUST）：

1. `result` が受理された
2. 構造ノートが本章の規則に従って完了と判定された
3. Performance が terminate により終端し、当該ノート評価が終端処理により completed 扱いになった（Profile で定義してよい）

### 8.4 構造ノート

#### 8.4.1 `sequence`（Normative）

* 子を順に開始（MUST）
* 全子完了で完了（MUST）

#### 8.4.2 `parallel`（Normative）

* 子の開始は並行でよい（MAY）
* v1.0.0 の既定は all-of（全子完了で完了）（MUST）

#### 8.4.3 `race`（Normative）

* 最初に完了した子が勝者（MUST）
* 残りは cancel（MUST）
* 勝者完了で親完了（MUST）

#### 8.4.4 `loop`（Normative）

* 反復条件（継続／停止）は Profile 定義（MUST）
* terminate を break/continue に使ってはならない（MUST NOT）

#### 8.4.5 `condition` / `switch`（Normative）

##### 8.4.5.1 Selection Resolution（Normative）

1. Runner は condition/switch の開始時（少なくとも `phase:"enter"` の前後）に、`note.data` に保持された **選択参照（opaque）**を **Profile resolver** で解決しなければならない（MUST）。
2. 解決が同期的であることが推奨される（SHOULD）。
3. 解決が非同期の場合、Runner は `phase:"active"` を記録し、解決完了を待ってから選択された子を開始しなければならない（MUST）。

##### 8.4.5.2 Selection（Normative）

* 選択確定後、該当子のみ開始（MUST）
* 非選択子は開始してはならない（MUST NOT）

### 8.5 suspend / resume（Normative）

* `resume` は Runner が記録する Phase（MUST）
* Semantics は resume タイミングに関与しない（MUST NOT imply）
* `until` の評価方法は Profile 定義（MUST）

---

## 9. Boundary Declaration（Normative）

score-fx は以下を規定しない（MUST NOT imply）：

* FRP / Stream の計算規則、atomic commit、tick
* effect の適用単位・適用方式（実行）
* Semantics の内部意味論（registry、DSL、実装）
* UI / DevTools 表現（Projection の形式）
* `payload` の意味（成功／失敗判定を含む）

---

## 10. Conformance（Normative）

実装が score-fx v1.0.0 に conformant であるためには：

1. §4 の Operational Rules を満たすこと（MUST）
2. §7 の SemanticEvent Vocabulary を closed set として扱うこと（MUST）
3. §8 の Structural Progression Rules に従うこと（MUST）

**Profile Slot note（Normative）**:
本仕様は Profile 自体の conformance を規定しない（MUST NOT）。

---

## 11. Frozen Declaration（Normative）

🔒 **Frozen**

* v1.0.0 は score-fx の基準点である。
* 後方互換を壊す変更は禁止（MUST NOT）。
* 意味論変更は MAJOR のみ（MUST）。
* SemanticEvent の語彙（Closed Set）と構造進行規則は v1.0.0 で凍結される（MUST）。

---

# END OF score-fx Protocol Specification v1.0.0
