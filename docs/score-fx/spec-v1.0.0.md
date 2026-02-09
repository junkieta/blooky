# score-fx Protocol Specification v1.0.0

**Project Name:** score-fx

**Version:** 1.0.0 (Score & Performance Edition)

**Status:** 🔒 Final Protocol Definition

---

## 1. Overview

**score-fx** は、非同期実行の構造を「譜面（Score）」、その過程を「演奏（Performance）」として定義するプロトコルである。実行の副作用を命令としてではなく、シリアライズ可能な「事実（PerformanceStep）」の堆積として扱うことで、**実行の透明性と観測可能性を確保する**ことを目的とする。

また、単一の実行結果や再現性を規範としない。  同一の Score から異なる Performance が生じうることを前提とし、  それらを **同一の構造に対する異なる演奏**として扱う。

この設計により、score-fx は実行の制御ではなく、  **実行の記述と解釈可能性**を中核的価値とする。

---

## 2. Terminology (命名定義)

| 用語 | 定義 | 役割 |
| --- | --- | --- |
| **FxNote** | 実行の小単位 | 譜面上の音符（記譜点）。処理の定義と識別子（`note_id`）を持つ。 |
| **FxScore** | 実行の構造定義 | 譜面。`FxNote` が構造化（直列・並列等）された集合。 |
| **Performance** | 実行ドメイン | 譜面が演奏される独立した空間。固有の `execution_id` を持つ。 |
| **PerformanceStep** | 実行の事実 | 演奏の一瞬を記録したデータ。不変の事実。 |
| **Timeline** | 時間構造（Temporal Structure） | Score 構造と実績 Step を重ね合わせ、進行位置と到達可能性を表す。Realized Timeline（実績）と Virtual Timeline（予測線）という射影を持つ。|
| **Runner** | 実行主体 | 奏者。Score を読み取り、事実を Timeline に刻む Agent。 |

---

## 3. Core Data Structures

### 3.1 PerformanceStep

演奏の最小記録単位。

* **`phase`**: `PerformancePhase` (後述)
* **`note_id`**: Score 内で一意の記譜点識別子
* **`execution_id`**: Performance を識別する一意の ID
* **`payload`**: **[Extensible]** そのフェーズに付随するデータ。上位層（blooky-fx 等）がコンテキストのスナップショット等を格納する器となる。
* **`effect`**: `EffectBinding` (後述)

Note: score-fx は Step の因果順序のみを規定し、到達保証や配送保証は Transport 層の責務とする。

### 3.2 PerformancePhase (演奏フェーズ)

Runner が `FxNote` を通過する際の状態遷移。

* **`enter`**: 記譜点に到達した。
* **`active`**: 記譜点の処理（非同期 IO 等）を開始した。
* **`suspend`**: 外部要因（子 Score、待機条件）により演奏を一時中断した。
* **`resume`**: 待機条件が解消し、演奏を再開した。
* **`exit`**: 記譜点の処理を完了し、値を確定させた。
* **`cancel`**: 演奏空間（Performance）の破棄により、処理が中断された。

---

## 4. Operational Rules (運用規則)

### 4.1 Score as a Blueprint (譜面の非干渉)

Score は静的であり、演奏中に自身を書き換えることはない。Runner は Score を読み取り専用として扱い、すべての動的な状態変化は Timeline（PerformanceStep）にのみ記録される。

### 4.2 Effect Binding (副作用の束縛)

`exit` フェーズにおいてのみ、最大1つの `effect` を付与できる。

* `effect` は実行そのものではなく、外部システム（FRP の Stream 注入等）への **参照情報** である。
* 形式: `{ kind: string, target: string, value: any }`

### 4.3 Error-to-Value Mapping (不協和音の処理)

演奏中に発生した例外は、制御例外（throw）として扱わず、計算結果としての「値」に変換する。

* エラーは `PerformanceStep.payload` に格納され、`exit` フェーズをもって記録される。
* 上位層はこれを `FxCallResult` 等として解釈する。

### 4.4 Cancellation Propagation (演奏の中止)

Performance が `cancel` された場合、Timeline は即座に `cancel` フェーズの Step を発行し、すべての Sub-Timeline（子演奏）に伝播させなければならない。キャンセル後の Step 発行は静かに無視される。

---

## 5. Timeline Model (記録と予測)

Timeline は、譜面（FxScore）の構造を段階的に解釈することで形成される時間構造である。
譜面はまず全体が到達可能性（Virtual Timeline）として解釈され、
それからなされる演奏によって実績（Realized Timeline）が具体化・実現されていく。

### 5.1 Realized Timeline (実績)

Realized Timeline は、「すでに起きた演奏の事実」を表す。
ここでいう事実とは、Runner により確定された `PerformanceStep` の連なりである。

Realized Timeline は過去の保存物であると同時に、観測者にとっての確定情報源である。

### 5.2 Virtual Timeline (予測線)

Virtual Timeline は、`FxScore` の構造に基づき、現時点から到達しうる `FxNote` の経路（到達可能性）を表す。
Virtual Timeline は「未来の候補」であり、まだ確定していないため、`PerformanceStep` としての事実を伴わない。

### 5.3 Observability（重ね合わせ）

Virtual Timeline は、どの順序で、どの範囲まで演奏が進行しうるかという時間構造を表す。
Realized Timeline は、この Virtual Timeline を参照しながら、Runner によって具体化・実現される演奏の射影である。

DevTools 等の観測者は、
Virtual Timeline（到達可能性の構造）と
Realized Timeline（具体化されつつある進行）を重ね合わせることで、
現在の進行位置と、未来に到達しうる演奏経路を可視化できる。

---

## 6. Observability Layer（観測）

Runner は `PerformanceStep` を生成した時点で、それを外部の観測者へ通知してよい（MAY）。
ただし観測は実行制御の手段として公開されるべきではない（SHOULD NOT）。
この通知は制御のためではなく、デバッグや可視化等の観測用途を目的とする。

score-fx は、通知の配送方式（同期/非同期、push/pull、永続化、再送、順序保証など）を規定しない。

### 6.1 ObservationPacket（通知フォーマット：参考）

以下は、観測者へ通知するための最小形式の一例である（informative）。

```typescript
type ObservationPacket = {
  execution_id: string;
  step: PerformanceStep;
}
```

実装は、必要に応じて追加フィールドを含めてもよい（MAY）。
ただし、その追加フィールドの意味解釈は score-fx の範囲外である。

---

## 7. SemanticEvent Vocabulary（Normative）

本章は、Semantics が Runner に対して yield できる **SemanticEvent の閉集合（closed set）**を定義する。
Runner は本章の規則に従ってイベントを解釈しなければならない（MUST）。

### 7.1 SemanticEvent とは

**SemanticEvent** は、Semantics がある `FxNote` を解釈する過程で生成する **通知（notification）**である。

* SemanticEvent は **制御命令ではない**（後述）。
* SemanticEvent の種類（kind）は **閉集合**であり、本仕様で定義されたもの以外を追加してはならない（MUST NOT）。

### 7.2 型定義（参考）

```ts
export type ConditionRef = unknown; // opaque reference

export type SemanticEvent =
  | { type: "result"; value: unknown }
  | { type: "suspend"; until: ConditionRef }
  | { type: "effect"; ref: unknown }
  | { type: "terminate"; value?: unknown };
```

### 7.3 配送と処理モデル

1. Semantics は 0 個以上の SemanticEvent を yield してよい（MAY）。
2. Runner は、Semantics が生成した順序どおりにイベントを処理しなければならない（MUST）。
3. Runner は、イベントを並べ替え・欠落・重複させてはならない（MUST NOT）。

### 7.4 制御命令ではない（重要）

SemanticEvent は、Runner に対して任意の subnote を選択・順序変更させるための命令として解釈されてはならない（MUST NOT）。

* subnote のスケジューリング（sequence/parallel/race 等）は、**Score 構造と Runner の構造規則**によって決まる。
* SemanticEvent は **観測可能な事実の通知**である。

### 7.5 `result(value)`

#### 意味

`result` は、当該ノートの意味的な値が **確定した**ことを示す。

#### 規則

1. Semantics は、1 つのノート評価に対して `result` を高々 1 回 yield してよい（MAY）。
2. Semantics が `result` を yield した場合、そのノート評価は **完了**とみなされる（MUST）。
3. `result` を yield した後、Semantics は当該ノート評価に関して **追加のイベントを yield してはならない**（MUST NOT）。
   （※ `effect` を出すなら `result` より前に出る必要がある）

#### Runner の義務

* Runner は `result.value` を、PerformanceStep の該当フィールドへ確実に反映しなければならない（MUST）。

### 7.6 `effect(ref)`

#### 意味

`effect` は、Semantics が解釈過程で得た **外部参照（binding / ref）を記録する**ための通知である。

* `effect` 自体は命令ではなく、**事実の記録**である。

#### 規則

1. Semantics は任意個の `effect` を yield してよい（MAY）。
2. Runner は `effect` によって **即時に副作用を実行してはならない**（MUST NOT）。
3. `ref` の具体的意味（FxRef への正規化やコミット方式）は、本仕様では規定しない。
   それは Bridge 仕様など上位（または隣接）仕様が規定してよい（MAY）。

#### Runner の義務

* Runner は `effect.ref` を、後段で Tick などの単位に集約できる形で **確実に記録**しなければならない（MUST）。
  （実装上はイベント列として保存して defer するのが推奨）

### 7.7 `suspend(until)`

#### 意味

`suspend` は、評価を継続できないため **待機状態に入る**ことを示す。

#### 規則

1. Semantics は、1 つのノート評価試行に対して `suspend` を高々 1 回 yield してよい（MAY）。
2. `until` は **ConditionRef（opaque）** でなければならない（MUST）。
3. `suspend` は値の確定を意味しない（MUST）。

#### Runner の義務

1. Runner は `suspend` を受け取ったら、当該ノート評価を **中断（suspended）**状態に遷移させなければならない（MUST）。
2. Runner は対応する step（例：`phase="suspend"`）を emit/record し、`until` を保持しなければならない（MUST）。
3. `until` が成立したと判断したら Runner は評価を再開し、再開 step（例：`phase="resume"`）を emit/record してから継続しなければならない（MUST）。

### 7.8 `terminate(value?)`（Performance-wide）

#### 意味

`terminate` は、**この Performance 全体を早期終了する**ことを示す。

* `terminate` は例外ではない。
* `terminate` は構造上の「完了」信号である。

#### 規則

1. Semantics は、1 つの Performance に対して `terminate` を高々 1 回 yield してよい（MAY）。
2. `terminate` は **Performance-wide** である（MUST）。
   すなわち、発生時点以降に予定されている実行（subnote の実行を含む）をすべて打ち切り、Performance を終端させる。
3. Semantics は `terminate` を yield した後、追加のイベントを yield してはならない（MUST NOT）。

#### `result` との排他（Normative）

* Semantics は、同一ノート評価（および同一 Performance）において `result` と `terminate` を **両方 yield してはならない**（MUST NOT）。
  どちらか一方のみが許可される。

#### Runner の義務

* Runner は `terminate` を受け取ったら、以下を行わなければならない（MUST）：

  1. 以後の subnote スケジューリングを停止する
  2. Performance を終端状態へ遷移させる
  3. 最終 step（例：`phase="exit"` あるいは `phase="cancel"`）を emit/record し、`value` があればそれを保持する
  4. Timeline の不変条件（順序・重複・欠落等）を破ってはならない

### 7.9 エラー方針（境界規範）

Semantics は Runner 境界をまたいで例外（throw）を漏らしてはならない（MUST NOT）。
内部エラーがある場合は、仕様が定める **値としての失敗表現**に落とし込むか、`terminate` を用いて制御された終端として表現しなければならない（MUST）。

---

## 8. Structural Progression Rules（構造進行規則 / Normative）

### 8.1 目的

本章は、Score の構造（subnotes を含むノート木）を **Runner がどのように進行（progression）として解釈するか**を定義する。
ここで定義されるのは **実行の外形（いつ子を開始し、いつ親が完了するか）**のみであり、各ノートの意味内容（Semantics の内部ロジック）や FRP/Bridge の詳細は対象外とする。

> この章が必要なのは、SemanticEvent を「制御命令ではない」と定義した結果、
> **進行の主権が Runner＋構造に完全に移った**ためである。

### 8.2 共通定義

#### 8.2.1 ノートの状態（Normative）

Runner は各ノートに対して、少なくとも以下の状態遷移を扱わなければならない（MUST）。

* **未開始（not-started）**
* **進行中（running）**
* **待機中（suspended）**
* **完了（completed）**
* **中止（cancelled）**

※ 内部表現は任意。ただし観測（Timeline/PerformanceStep）上は区別できる必要がある。

#### 8.2.2 完了（completion）の定義（Normative）

ノートは、以下のいずれかで **完了（completed）**とみなされる（MUST）。

1. Semantics が `result(value)` を yield し、Runner がそれを受理した
2. Semantics が `terminate(value?)` を yield し、（本仕様が定義するスコープで）Performance が終端した
3. Runner が本章の構造規則に従って「完了した」と判定した

   * 例：sequence の親が、子ノートをすべて完了させた

> 注：`terminate` は Performance-wide（Performance 全体の終端）であり、個別ノート完了の一般手段ではない。

#### 8.2.3 排他（Normative）

同一ノート評価において、Semantics は `result` と `terminate` を両方 yield してはならない（MUST NOT）。

#### 8.2.4 例外の禁止（境界規範 / Normative）

Semantics は Runner 境界をまたいで throw を漏らしてはならない（MUST NOT）。
Runner も境界外へ throw を漏らさないことが推奨される（SHOULD）。
（値としての失敗表現は別章/別仕様で規定してよい）

### 8.3 subnotes の開始規則（共通）

#### 8.3.1 開始権限（Normative）

Runner は、親ノートの構造規則が許すタイミングでのみ子ノート（subnote）を開始してよい（MUST）。
SemanticEvent は子ノートの開始順序・選択を指示する命令として解釈してはならない（MUST NOT）。

#### 8.3.2 再入（Normative）

同一ノートを重複して開始してはならない（MUST NOT）。
（loop 等で再実行する場合は「新しい評価インスタンス」として扱うか、Runner の管理下で再入を明示的に区別する）

### 8.4 構造ノートごとの進行規則（最小）

> ここでは **最小の外形**だけを書く。
> “いつ開始するか / いつ完了するか / terminate/cancel が来たらどうするか” のみ。

#### 8.4.1 `sequence`（順次実行）

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

#### 8.4.2 `parallel`（並列実行）

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

#### 8.4.3 `race`（最初に終わったものが勝つ）

**開始**

* `race` の開始時、Runner は全ての子ノートを開始してよい（MAY）。

**勝者決定**

* 最初に **完了**した子ノートを勝者とする（MUST）。

  * 完了とは 8.2.2 に定義した completed を指す（result による完了が基本）

**残りの扱い**

* 勝者が決定した時点で、Runner は残りの子ノートを中止（cancel）しなければならない（MUST）。
  （中止理由や CancelToken の詳細は別章/別仕様でよい）

**race 自身の完了**

* 勝者決定と同時に `race` は完了とみなされる（MUST）。

#### 8.4.4 `loop`（反復）

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

#### 8.4.5 `condition` / `switch`（分岐）

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

### 8.5 `suspend` と再開（resume）

#### 8.5.1 `suspend(until)` の opaque 化（Normative）

`suspend.until` の型は `ConditionRef`（opaque）である。
ConditionRef の評価方法（真偽判定・購読・ポーリング等）は **プロファイル**が定義する。

#### 8.5.2 Runner の義務（Normative）

* Runner は `suspend` を受け取ったら、該当ノートを suspended に遷移させる（MUST）。
* Runner は ConditionRef が “成立”したと判断したら、ノートを running に戻し、再評価を継続する（MUST）。
* `resume` は SemanticEvent ではなく Runner が Timeline 上の step として刻む（MUST）。
  （step の厳密な種類名は本仕様の step 定義に従う）

### 8.6 `terminate`（Performance-wide）

#### 8.6.1 意味（Normative）

`terminate` は **Performance 全体を早期終了**させる通知である。
Runner は `terminate` を受け取ったら、以後の subnote スケジューリングを停止し、Performance を終端しなければならない（MUST）。

#### 8.6.2 伝播（Normative）

`terminate` は局所スコープに閉じてはならない（MUST NOT）。
（region termination を設けない）

### 8.7 これ以上を score-fx に入れない（境界宣言）

本章は以下を規定しない（MUST NOT imply）：

* FRP（Prop/Stream）の計算規則や atomic commit（Tick）
* effect の適用単位（Bridge の責務）
* Semantics の内部意味論（blooky-fx registry の責務）
* DevTools/UI の投影

---

## Appendix A: Design & Interpretation Rules（規約版）

**Note:** 設計判断の最終結果のみを規定する。背景となる代替案の検討は本規約の対象外である。

---

### 1. Core Manifesto (設計原則)

1.1 **Staticity of FxScore**: `FxScore`は譜面、不変の設計図であり、実行中に自身を書き換えない。
1.2 **FxNote as a Point**: `FxNote` は譜面上の記譜点であり、ロジックや駆動能力を持たない。
1.3 **Runner as a Performer**: 演奏の主権は `Runner` にあり、**これにより譜面（構造）と実行（時間）は物理的に分離される。**

---

### 2. The Score Layer (AST 定義)

2.1 **FxNote Interface**

```typescript
interface FxNote {
  readonly note_id: string; // 譜面内一意の識別子
  readonly kind: string;    // 意味論(Semantics)の識別キー
  readonly data: any;        // 静的な定義データ
  getSubNotes(): FxNote[];   // 構造上の下位要素。Runner はこれを用いて Virtual Timeline を構築する。
}
```

2.2 **FxScore Structure**
`root: FxNote` を起点とする、シリアライズ可能なデータ構造。

---

### 3. Semantics Contract (解釈インターフェース)

3.1 **Role and Sovereignty**: Semantics は Note を解釈するが、演奏（Performance）そのものは行わない。
3.2 **One-way Communication**: Semantics と Runner は、Generator を通じた一方向の通信（合図の発行）のみを行う。
3.3 **The Resumption Principle**: `resume` は `SemanticEvent` ではない。**再開は「世界の状態が変化した事実」の観測であり、実行管理上の判断である。** Semantics は再開のタイミングに関知しない。

---

### 4. The Performance Layer (事実の記録)

4.1 **PerformanceStep**: 演奏中に発生した不変の事実。`phase`, `note_id`, `payload`, `effect`, `timestamp` を含む。
4.2 **Error-to-Value Mapping**: 例外は `throw` せず、`result(errorValue)` として `exit` フェーズの `payload` にカプセル化する。

---

## Appendix B: Versioning Policy

本仕様は **Semantic Versioning（MAJOR.MINOR.PATCH）** に基づいて管理される。
ただし、本仕様における「互換性」は **実装 API ではなく、仕様準拠性（conformance）** を基準とする。

### 1. Compatibility Definition（互換性の定義）

あるバージョン *vX.Y.Z* に準拠した実装が、
*vX.Y.(Z+1)* または *vX.(Y+1).0* の仕様を読んだ際に
**非準拠と判定されない**場合、その変更は後方互換であるとみなす。

本仕様は、**実行結果の一意性や再現性を互換性の条件としない**。

---

### 2. PATCH Version（X.Y.Z+1）

PATCH バージョンは、**仕様の意味論を変更しない修正**に対して割り当てられる。

含まれる変更例：

* 誤字・脱字・表現上の誤解を招く記述の修正
* 実装を不必要に拘束していた記述の削除・緩和
* 用語定義の明確化（意味の変更を伴わないもの）
* 外部仕様・固有名詞への不要な依存の除去
* Informative（非規範）セクションの修正

PATCH 更新により、既存の準拠実装が非準拠になることはない。

---

### 3. MINOR Version（X.Y+1.0）

MINOR バージョンは、**後方互換性を保った拡張**に対して割り当てられる。

含まれる変更例：

* 新しい概念・用語・章の追加（既存定義の意味を変更しないもの）
* 任意要素（MAY / OPTIONAL）の追加
* Informative な Appendix や Design Notes の追加
* 既存の曖昧な規定を、互換性を保ったまま規範化する変更

MINOR 更新では、既存実装は引き続き準拠とみなされる。

---

### 4. MAJOR Version（X+1.0.0）

MAJOR バージョンは、**後方互換性を破る変更**に対して割り当てられる。

含まれる変更例：

* 既存の必須要件（MUST）の意味変更・削除
* これまで許容されていた挙動を禁止する変更
* 中核概念（Score / Performance / Timeline 等）の意味的再定義
* 準拠判定基準そのものの変更

MAJOR 更新では、既存実装が非準拠となりうる。

---

### 5. Frozen Declaration と Versioning の関係

本仕様における **Frozen** とは、

> 「後方互換性ポリシーを変更しない」

ことを意味し、
**文言の一切の変更を禁止することを意味しない**。

Frozen 状態においても、
PATCH バージョンによる修正および明確化は許容される。

---

### 6. Pre-release Editing Policy（公開前編集）

公開前の仕様については、**バージョン番号を変更することなく内容を修正してよい**。
最初に公開された版が、その MAJOR.MINOR 系列における**基準版（X.Y.0）**となる。

---


**END OF SPECIFICATION v1.0.0**
