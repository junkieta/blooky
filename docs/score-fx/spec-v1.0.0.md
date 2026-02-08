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
