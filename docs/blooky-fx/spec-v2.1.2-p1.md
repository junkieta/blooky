# SPEC v2.1.2 Patch Application

このパッチは**設計を一切変えず、メンタルモデルを正す**ものです。

---

## Patch Metadata

**Patch ID:** v2.1.2-p1  
**Type:** Terminology & Mental Model Clarification  
**Semantic Change:** ❌ None  
**Implementation Impact:** ❌ None  
**Status:** Ready to Apply

---

## Modified Sections

### 1. Overview (完全差し替え)

```markdown
## 1. Overview

blooky-fx は関数型リアクティブプログラミング（FRP）の原則に基づいた、宣言的な非同期実行フレームワークです。

### Design Goals

1. **Timeline = 時間構造（Temporal Structure）**  
   Timeline は ExecutionStep を「記録するログ」ではなく、Execution がどのような時間構造を持つかを定義・保持する器である。ExecutionStep は Timeline 上の「進行位置」を示す観測可能な事実であり、Timeline 自体は過去の保存物ではなく、実行中・待機中・未到達の未来を含む構造体である。Timeline は制御装置ではないが、Runner が従うべき時間的・構造的な譜面を提供する。

2. **制御は構造で表現**  
   すべての実行制御は Fx ツリーまたは Prop で明示的に表現される。

3. **観測は特権**  
   ExecutionStep の観測は DevTools 専用の特権であり、通常のアプリケーション API には公開されない。

4. **Document Model の一貫性**  
   fx-flow / fx-yield / Remote は HTML の template / iframe / cross-origin と同じメンタルモデルを持つ。

5. **Timeline as Score**  
   Timeline は音楽における譜面のように、実行の「構造」と「進行可能性」を表す。Runner は譜面を読む演奏者であり、Timeline は演奏の結果を記録する装置ではない。
```

---

### 3.2 ExecutionStep (定義の差し替え)

```markdown
### 3.2 ExecutionStep

ExecutionStep は FxNode 実行中における Timeline 上の進行位置を示す不変の観測事実である。

ExecutionStep は「過去ログ」ではなく、Timeline 上で現在どこにいるか／どこで停止しているかを外部（DevTools）に示すための最小単位である。

```typescript
type ExecutionStep = {
  phase: ExecutionPhase
  node: FxNode
  data?: unknown
  effect?: DripEffect<any>  // exit phase でのみ存在
}

type ExecutionPhase =
  | "enter"     // ノードに入った
  | "active"    // 処理を実行中
  | "suspend"   // 外部条件待ち（主権委譲）
  | "resume"    // 待ちから復帰
  | "exit"      // 正常終了
  | "cancel"    // 破棄（v2.1.2）
```

**重要:**

ExecutionStep は**意味論を持たない**。

実行制御・分岐・結果はすべて Fx ツリーにより決定される。

Step は Timeline 上で進行が確定した位置の通知である。
```

---

### 3.4 Timeline (定義の全文差し替え)

```markdown
### 3.4 Timeline

Timeline は ExecutionStep を内包する**時間構造（temporal structure）**である。

Timeline は以下を保持する:

- FxNode の時間的な配置
- suspend による未解決の待機点
- 子 Timeline との構造的関係
- cancel による破棄可能性

ExecutionStep は Timeline に「追加される記録」ではなく、Timeline 上で進行が確定した位置の通知である。

```typescript
interface Timeline {
  readonly executionId: string
  emit(step: ExecutionStep): Promise<void>
  cancel(reason?: CancelReason): void
  isCancelled(): boolean
}
```

**Timeline の責務:**
- ✅ ExecutionStep を受け取り、時間構造上の位置を確定する
- ✅ DripEffect を適用する（exit phase のみ）
- ✅ 子 Timeline との構造的関係を維持する
- ✅ cancel を子に伝播する

**Timeline の非責務:**
- ❌ 実行フローを外部から変更する
- ❌ Step を改変する
- ❌ FxNode の実行ロジックに介入する
- ❌ Runner を制御する

**Timeline と Runner の関係:**

Runner は Timeline を「進める」のではない。Timeline も Runner を「制御」しない。

Runner は Timeline によって定義された suspend / resume / cancel の構造に従って実行を行い、その結果として ExecutionStep が観測される。
```

---

### 8.1 Timeline Design Principles (修正)

```markdown
### 8.1 Timeline is a Temporal Structure, Not a Controller

Timeline は ExecutionStep を内包する時間構造である。

**Timeline の本質:**

Timeline は「過去のログ」ではなく、実行の「構造的な譜面」である。

- 実行中のノード
- 待機中の suspend
- 未到達の未来
- 子 Timeline との関係

これらすべてを含む構造体が Timeline である。

**Runner との関係:**

Runner は FxNode を実行する主体であり、Timeline は Runner が従うべき時間的・構造的制約を表す器である。

```
Runner (演奏者)
   ↓ 従う
Timeline (譜面)
   ↓ 通知
ExecutionStep (進行位置)
   ↓ 観測
DevTools (聴衆)
```

Runner は Timeline によって定義された suspend / resume / cancel の構造に従って実行を行い、その結果として ExecutionStep が観測される。
```

---

### 12.1 Cancel as Document Destruction (修正)

```markdown
### 12.1 Cancel as Document Destruction

**Definition:**

cancel は Timeline という時間構造そのものの破棄を表す構造イベントである。

これは「記録の削除」ではなく、進行中および未到達の未来を含む構造の終了を意味する。

```html
<!-- Analogy -->
<iframe id="child"></iframe>

<script>
  // iframe を削除
  document.getElementById('child').remove()
  // → Child Document は破棄される
  // → 未来の実行も含めて消滅
</script>
```

cancel により:
- 実行中の処理が停止
- 待機中の suspend が解消
- 未到達の未来が消滅
- 子 Timeline も破棄
```

---

### 17. Runner Specification (修正)

```markdown
## 17. Runner Specification

### 17.1 Runner と Timeline の関係

Runner は FxNode を実行する主体であり、Timeline は Runner が従うべき時間的・構造的制約を表す器である。

**重要な非対称性:**

```
Runner は Timeline を「進める」のではない
Timeline も Runner を「制御」しない
```

Runner は Timeline によって定義された suspend / resume / cancel の構造に従って実行を行い、その結果として ExecutionStep が観測される。

**Analogy: 演奏者と譜面**

```
Timeline (譜面)
  - 音符の配置
  - 待機記号（suspend）
  - 構造（繰り返し、並行）
  
Runner (演奏者)
  - 譜面を読む
  - 実際に音を出す
  - suspend では待つ
  
ExecutionStep (演奏位置)
  - 「今ここを演奏中」
  - 聴衆（DevTools）に見える
```

---

### 17.2 Responsibilities

Runner は Child Flow の実行を orchestrate する。

**責務:**
- Timeline が定義する構造に従って FxNode を実行
- Child Context の生成
- Child Timeline の生成
- Child Flow を最後まで実行
- exit value を返す

**非責務:**
- Timeline を改変する
- 値の解釈
- エラーハンドリング（throw しない）
- cancel の判断（Timeline から伝播される）
```

---

### 20. DevTools Display Model (追記)

```markdown
## 20. DevTools Display Model

### 20.1 Observation Principle

DevTools が観測するのは ExecutionStep の列ではなく、Timeline 構造上の現在位置と進行状況である。

表示はログではなく、「どの譜面の、どこが、今演奏されているか」を示すビューである。

**Timeline 構造の可視化:**

```
Timeline (譜面)
  ├─ fx-sequence (構造)
  │   ├─ fx-call (完了済み) ✓
  │   ├─ fx-yield (実行中) ←
  │   │   └─ Child Timeline
  │   │       ├─ fx-call (完了済み) ✓
  │   │       └─ fx-wait (待機中) ⏸
  │   └─ fx-call (未到達) ·
```

**Key Points:**

1. **構造が見える**
   - 完了済み / 実行中 / 未到達 が区別される
   - suspend による待機点が明確

2. **進行位置が見える**
   - 現在どこにいるか（← マーク）
   - どこで止まっているか（⏸ マーク）

3. **ログではない**
   - 過去の記録ではなく、現在の構造
   - 未来も含む全体像

---

### 20.2 Nested View (Primary)

```
Parent Timeline (exec-abc)
├─ fx-call: before (completed)
├─ fx-yield: subFlow (suspend)
│   └─ Child Timeline (exec-abc:yield-1)
│       ├─ fx-call: remote1 (completed)
│       └─ fx-call: remote2 (active)
└─ fx-call: after (pending)
```

**表示の意味:**

- `completed` = Timeline 上で通過済み
- `suspend` = 待機中（子に主権委譲）
- `active` = 現在実行中
- `pending` = 未到達の未来

---

### 20.3 Cancel Visualization

```
Parent Timeline (exec-abc)
├─ fx-sequence (enter)
│   ├─ fx-yield: childFlow (enter)
│   ├─ fx-yield: childFlow (suspend)
│   │   └─ Child Timeline (exec-abc:child)
│   │       ├─ fx-call: compute (enter)
│   │       ├─ fx-call: compute (active)
│   │       └─ cancel (reason: "user")  ← 構造の破棄
│   └─ cancel (reason: "user")
```

**cancel の表示:**

- 進行中および未到達の未来が消滅
- Timeline 構造自体が終了
- ログの削除ではなく、譜面の破棄
```

---

## Appendix B: Glossary (Updated)

```markdown
## Appendix B: Glossary

| 用語 | 定義 |
|------|------|
| **FxNode** | 実行可能な最小単位。execute() で ExecutionStep を yield する。 |
| **ExecutionStep** | Timeline 上の進行位置を示す不変の観測事実。 |
| **Timeline** | FxNode の時間的配置と構造的関係を保持する時間構造（temporal structure）。「過去ログ」ではなく「譜面」。 |
| **Runner** | FxNode を実行する主体。Timeline が定義する構造に従って実行を進める「演奏者」。 |
| **DripEffect** | FRP における状態更新の設計図。exit phase でのみ適用される。 |
| **Prop** | 時変値を返す関数。FRP の基本単位。 |
| **Stream** | Prop への値の流れを表現。Dripper から始まる。 |
| **stepClock** | ExecutionStep の観測機構。clock の対称概念。 |
| **DevTools** | Timeline 構造と進行位置を観測する特権的なツール。 |
| **Document** | fx-flow から fx-yield により生成される、id 名前空間と実行文脈の単位。 |
| **Flow** | Document を生成するための Template。 |
| **Yield** | Flow から Document を生成し、実行を委譲する操作。 |
| **cancel** | Timeline 構造の破棄。進行中および未到達の未来を含む終了。 |
| **FxCallResult** | fx-call の実行結果を表す型。成功/失敗を値として表現。 |
```

---

## Patch Summary

### 変更点

| セクション | 変更内容 |
|-----------|---------|
| **1. Overview** | Timeline = 時間構造（譜面）に修正 |
| **3.2 ExecutionStep** | 進行位置の通知として再定義 |
| **3.4 Timeline** | 時間構造の定義に全文差し替え |
| **8.1 Design Principles** | Runner との関係を明確化 |
| **12.1 Cancel** | 構造の破棄として再定義 |
| **17. Runner** | 譜面と演奏者の比喩を追加 |
| **20. DevTools** | 構造可視化の原則を追加 |
| **Glossary** | Timeline / Runner の定義を更新 |

### 影響範囲

- ✅ **SPEC の読解モデル** - 改善
- ❌ **設計判断** - 変更なし
- ❌ **実装** - 変更なし
- ❌ **API** - 変更なし

### 達成されること

このパッチにより:

1. **Timeline のメンタルモデルが正確になる**
   - ❌ ログ / レコーダー / 実行エンジン
   - ✅ 時間構造 / 譜面 / Document の骨格

2. **Runner との関係が明確になる**
   - Runner は Timeline を「進める」のではない
   - Timeline も Runner を「制御」しない
   - Runner は構造に従って実行し、結果が観測される

3. **DevTools の役割が明確になる**
   - ログビューアではなく構造ビューア
   - 進行位置の可視化
   - 未来も含む全体像の表示

4. **fxdom との整合性が保たれる**
   - Timeline と DOM の 1:1 対応が自然
   - Element = 構造上のノード
   - Step = 進行位置の投影

---

## Version History Update

```markdown
## Appendix C: Version History

| Version | Date | Changes |
|---------|------|---------|
| **2.1.2-p1** | 2026-02-04 | **Patch**: Timeline のメンタルモデルを「記録者」から「時間構造（譜面）」に修正。設計・実装への影響なし。用語の明確化のみ。 |
| **2.1.2** | 2026-02-04 | cancel semantics 追加、FxCallResult 確定、Runner Specification 追加、Output Binding Pattern 完成。 |
| **2.1.1** | 2026-02-04 | LocalTimeline Implementation Specification 追加。 |
| **2.1** | 2026-02-04 | **Breaking:** `FxCollapseNode` 削除。 |
| **2.0** | 2026-02-03 | Design Freeze: Flow Model 確定。 |
| **1.0** | 2026-02-03 | 初版リリース。 |
```

# Appendix D: Naming, Projection, and Snapshot Semantics

## D.1 Background: Why Naming Required Reconsideration

SPEC v2.1.2 の策定過程において、DevTools 向け可視化モデルの命名として
当初 **DocumentView** という語が検討された。

しかし検討を進める中で、この命名には以下の問題が明らかになった。

### 1. DOM 標準との語彙衝突

`DocumentView` は DOM Level 2 Views においてすでに定義済みの概念であり、

* 同名
* 意味論が異なる
* 実装・型定義・認知のすべてにおいて混線の危険がある

という点で、採用すべきではないと判断された。

### 2. 「Document」の意味論が一致しない

blooky-fx における *Document* は、

* fx-flow / fx-yield により生成される
* 実行コンテキストおよび id 名前空間の単位

であり、DOM の Document と **強い類似性はあるが同一ではない**。

一方、DevTools が扱う対象は

* Document そのもの
* あるいは DOM ツリー

ではなく、

> ExecutionStep の列を、構造（fx-flow / fx-yield）に当てはめて理解可能にしたもの

である。

そのため「Document の View」という表現は、
意図する対象を正確に表していないことが明確になった。

---

## D.2 TimelineView 案と残った違和感

次の候補として **TimelineView** が検討された。

Timeline を「譜面」と見なし、その可視化モデルと捉える点では
設計意図と高い整合性があった。

しかしこの命名にも、設計上の違和感が残った。

### Timeline は「概念」である

Timeline は、

* 時間を貫く抽象概念
* 実行の因果関係を表す設計図

であり、それ自体が「物」や「実体」ではない。

そのため、

> TimelineView = Timeline を写した実体

という命名は、

* 抽象概念を実体化しているように見える
* アーキテクチャ理解に余分な認知負荷を与える

という問題を内包していた。

---

## D.3 転換点: 「View」ではなく「Snapshot / Projection」

上記の議論を通じて、可視化モデルの本質は

> **何かの View（実体）ではなく、観測と投影という行為の結果**

である、という整理に至った。

### 実行と観測の非対称性

* **ExecutionStep**

  * 実行器内部で発生する事実
  * 因果的・連続的・ローカル

* **DevTools が扱う値**

  * 観測結果
  * 離散的・非因果的・シリアライズ可能

特に Remote 実行では、
ExecutionStep そのものではなく *観測可能な値* しか扱えない。

この差異を明示するため、
**Snapshot** という語が導入された。

---

## D.4 ExecutionSnapshot / TimelineSnapshot

### ExecutionSnapshot

ExecutionSnapshot は、

* ExecutionStep を直接参照しない
* 観測可能な情報のみを含む
* シリアライズ可能な値

として定義される。

これは「実行そのもの」ではなく、

> 実行を観測した結果

である。

### TimelineSnapshot

TimelineSnapshot は、

* ExecutionSnapshot 群を
* fx-flow / fx-yield による構造（Timeline）に当てはめた
* 観測用の投影結果

である。

TimelineSnapshot は Timeline そのものではない。

> Timeline という設計図に
> 観測された Execution の断片を当てはめた像

である。

---

## D.5 fxdom との関係性

この整理により、fxdom の二面性が明確になる。

### fxdom は：

1. **作用を記述する言語**

   * FxNode を DOM 的構造として表現する
   * 多くの利用者にとって理解の起点となる

2. **Execution の投影面**

   * ExecutionSnapshot / TimelineSnapshot が当てはまる器
   * 状態は fxdom 自身が保持するものではない

fxdom は「単なる投影先」ではないが、
同時に「Execution の実体」でもない。

> 記述言語であり、かつ投影面である

という位置づけが、この Snapshot / Projection モデルによって保たれる。

---

## D.6 View をクラスとして定義しない理由

以上の整理から、DevTools における可視化は

* class としての View
* 状態を持つ ViewModel

として定義されない。

代わりに、

* ExecutionStep → ExecutionSnapshot
* ExecutionSnapshot + Timeline 構造 → TimelineSnapshot
* TimelineSnapshot → fxdom への投影

という **純粋な変換パイプライン**として扱われる。

これは FRP の設計思想とも一致し、

* 観測は値
* 可視化は変換

であることを明確にする。

---

## D.7 Summary

この命名および概念整理の転換は、

> 実行（Execution）
> 観測（Snapshot）
> 記述（fxdom）

という三層を明確に分離する。
これにより、

* DOM との不必要な混線を避け
* Timeline を過度に実体化せず
* fxdom を言語としても投影面としても正しく位置づける

ことが可能になる。

## D.8 Layer Diagram
```
Execution (実行層)
  ExecutionStep ──┐
  Timeline ───────┼─→ 実行の事実・構造
  Runner ─────────┘
         ↓ 観測（変換）
Observation (観測層)
  ExecutionSnapshot ─┐
  TimelineSnapshot ──┼─→ 観測された値
  Projection ────────┘
         ↓ 投影（表示）
Presentation (表現層)
  fxdom ─────────┐
  DevTools ──────┼─→ 可視化・操作
  DOM ───────────┘
```

**Layer Boundaries:**

- Execution → Observation: 変換のみ（参照なし）
- Observation → Presentation: 投影のみ（状態なし）
- Presentation → Execution: イベント経由のみ

## D.9 Custom State の拡張性

現在の実装は 1 state 制（phase に対応する単一の state）を採用している。

将来的に以下のような複数 state の併用が必要になる可能性がある:

- **Phase State**: entered / active / suspended / completed
- **Semantic State**: has-effect / error / remote / cached

現在の設計は、こうした拡張を妨げない。
```typescript
// 将来の拡張例
states.add('active')       // phase state
states.add('has-effect')   // semantic state
states.add('remote')       // execution context state
```

Custom State API の仕様により、複数の state を同時に保持可能である。

### D.10 Projection Pipeline の拡張性

現在の `projectTimeline()` は単一関数で以下を行っている:

1. Timeline 構造の再構成
2. State の導出
3. Snapshot の配置

これは最小実装として適切だが、Remote の本格運用時に以下への分離が必要になる可能性:

- `buildTimelineStructure()` - structure 情報の生成
- `aggregateTimelineState()` - state の集約ロジック
- `attachSnapshots()` - snapshot の配置戦略

**拡張ポイント:**
- state 定義の変更（カスタム状態判定）
- children 解釈の変更（ネスト構造の再構成）
- structure の外部ソース（Flow Registry）

### D.11 Timeline State vs Node State

Projection において、2 種類の「状態」が存在する:

**1. TimelineState（Timeline 全体の状態）**
```typescript
type TimelineState =
  | "pending"    // 未開始
  | "running"    // 実行中
  | "suspended"  // 待機中（子に委譲）
  | "completed"  // 完了
  | "cancelled"  // キャンセル済み
```

これは Execution 全体の進行状態を表す。

**2. FxElementState（個別 Node の状態）**
```typescript
type FxElementState =
  | "pending"     // 未開始
  | "entered"     // enter phase
  | "active"      // active phase
  | "suspended"   // suspend phase
  | "resumed"     // resume phase
  | "completed"   // exit phase
  | "cancelled"   // cancel phase
```

これは個別 Node の観測フェーズを表す。

**投影における使い分け:**
```typescript
// Timeline 全体の状態
ctx.root.dataset.fxTimelineState = "running"

// 個別 Node の状態
element.dataset.fxState = "active"
```

**CSS での使用:**
```css
/* Timeline 全体の状態 */
fx-flow[data-fx-timeline-state="running"] {
  border: 2px solid #4CAF50;
}

/* 個別 Node の状態 */
fx-call:state(active) {
  background-color: rgba(76, 175, 80, 0.1);
}
```

# Appendix E: ExecutionSnapshot Design Rationale (Draft)

## E.1 Purpose and Scope

本 Appendix は、DevTools / Projection 層において用いられる
**ExecutionSnapshot** の設計意図・責務・制約を明確化することを目的とする。

ExecutionSnapshot は、

* 実行（Execution）そのものではない
* 可視化モデル（View / ViewModel）でもない

Execution を**観測した結果として得られる値**であり、
Local / Remote を問わず共通に扱える最小単位として定義される。

本 Appendix は特に以下を明確にする。

* ExecutionSnapshot が **何であるか**
* ExecutionSnapshot が **何ではないか**
* Projection 層・fxdom・Timeline との正確な境界
* 順序性・欠損・Remote 実行に関する前提条件

---

## E.2 What ExecutionSnapshot *Is*

ExecutionSnapshot は以下の性質を持つ。

### E.2.1 観測結果としての値

ExecutionSnapshot は、

* Runner 内部で発生した ExecutionStep を
* 観測可能な情報に変換した
* **シリアライズ可能な値**

である。

これは「実行の再現」や「再生」を目的としない。

> ExecutionSnapshot =
> **実行を観測した結果を、値として切り出したもの**

---

### E.2.2 Projection に耐える最小単位

ExecutionSnapshot は、

* DevTools / Projection 層で
* fxdom 構造と重ね合わせて理解される

ことを前提とするが、
**自ら構造や意味論を持たない**。

構造解釈・意味付け・可視化は、
すべて Projection 層の責務である。

---

## E.3 What ExecutionSnapshot *Is Not*

### E.3.1 Execution の意味や構造を表さない

ExecutionSnapshot は以下を行わない。

* Timeline 構造の内包
* 因果関係の記述
* FxNode / FxConditionNode 等の意味論の保持

ExecutionSnapshot は「点」であり、「線」や「面」ではない。

---

### E.3.2 View / ViewModel ではない

ExecutionSnapshot は、

* UI 状態
* 派生状態
* 集約ロジック

を一切持たない。

特に以下を禁止する。

* Snapshot 自身が状態遷移を解釈すること
* 他 Snapshot との関係性を前提とすること

---

## E.4 Identification and fxdom Projection

### E.4.1 前提条件：fxdom 構造の事前共有

DevTools / Projection 層は、以下を前提とする。

* fxdom（fxtree）構造は

  * ExecutionSnapshot より前に
  * 完全な形で共有されている
* fxdom 要素は、構造内で一意な `nodeId` を持つ

この前提により、ExecutionSnapshot は
**fxdom 要素を参照するための最小キーのみ**を持てばよい。

---

### E.4.2 nodeId の責務

ExecutionSnapshot に含まれる `nodeId` は、

* fxdom 構造内の要素を指し示すための
* **参照キー**

である。

これは：

* Execution の意味
* ノード種別
* 実行構造

を表すものではない。

---

### E.4.3 nodeType の扱い

`nodeType` は以下の理由から **必須ではない**。

* fxdom 構造は Projection 層で既知
* nodeId により一意に対応可能

従って、

* nodeType は削除されるか
* もしくは **非推奨の冗長デバッグ情報**

として扱われる。

ExecutionSnapshot が自己完結的な ViewModel になることを防ぐため、
nodeType に意味論を持たせてはならない。

---

## E.5 Effect Observation Semantics

### E.5.1 hasEffect の問題点

`hasEffect: boolean` は、

* 情報量が少なく
* 意味論を持たず
* DevTools 側の可視化価値が低い

ため、最終形としては不適切である。

---

### E.5.2 名前による Effect 観測

Effect が context 空間において
**名前と結び付けられた prop**である場合、

ExecutionSnapshot は：

* Effect の「有無」ではなく
* **Effect 名の集合**

を返すことができる。

例：

```ts
effectNames?: string[]
```

これは：

* Effect の意味論を Snapshot に持ち込まず
* Projection 層での重ね合わせを可能にする

という点で、設計思想と整合する。

---

## E.6 Ordering Semantics of ExecutionSnapshot

### E.6.1 欠損と順序の分離

Remote 実行において重要なのは、

* **欠損の可能性**
* **順序逆転の不可能性**

を明確に分けることである。

---

### E.6.2 正しい前提条件

ExecutionSnapshot について、以下を保証する。

* 同一 Timeline 内で観測された Snapshot 間の相対順序は保存される
* `observedAt` は単調増加である
* Remote 実行では：

  * 一部の Snapshot が欠落する可能性はある
  * しかし **後の実行が先に届くことはない**

従って、

> 「到着順と実行順が一致しない」

という表現は誤りであり、採用しない。

---

### E.6.3 非因果性の正しい意味

ExecutionSnapshot が「非因果的」とされるのは、

* 因果関係が失われるからではなく
* **因果を再構成する責務を持たない**からである

因果・構造・意味は Projection 層で与えられる。

---

## E.7 Relationship to TimelineSnapshot

TimelineSnapshot は、

* ExecutionSnapshot 群を
* fxdom / Timeline 構造に当てはめた
* **観測結果の投影像**

である。

ただし、

* TimelineSnapshot がどこまで構造を持つか
* 構造と投影の最終的な境界

は **現時点では未確定**とする。

本 Appendix は、
ExecutionSnapshot を「値として凍結」することを優先し、
TimelineSnapshot の最終形は後続 Appendix に委ねる。

---

## E.8 Summary

ExecutionSnapshot は、

* 実行でも
* View でもなく
* 観測された事実を表す最小の値

である。

この整理により：

* Snapshot の ViewModel 化を防ぎ
* fxdom を記述言語かつ投影面として正しく位置づけ
* Local / Remote 共通の Projection Pipeline を成立させる

ための設計基盤が確定する。

---

# Appendix F: Implementation Notes and Future Extensions

このセクションは、現在の実装における意図的な未確定点と将来の拡張ポイントを記録する。

---

## F.1 Projection Pipeline の拡張性

**現状:**

`projectTimeline()` は単一関数で以下を行っている:
- Timeline 構造の再構成
- State の導出
- Snapshot の配置

**将来の分離ポイント:**
- `buildTimelineStructure()` - structure 情報の生成
- `aggregateTimelineState()` - state の集約ロジック
- `attachSnapshots()` - snapshot の配置戦略

**必要になる状況:**
- state 定義の変更（カスタム状態判定）
- children 解釈の変更（ネスト構造の再構成）
- structure の外部ソース（Flow Registry）

---

## F.2 Custom State の拡張

**現状:**

1 state 制（phase state のみ）。

**将来の拡張:**

複数 state の併用:
- Phase State: entered / active / suspended / completed
- Semantic State: has-effect / error / remote / cached

**実装上の注意:**

`states.clear()` は全クリアのため、semantic state も消える。
将来は namespace 付き管理が必要。

---

## F.3 Timeline State vs Node State

**2 種類の状態:**

1. **TimelineState** - Execution 全体の進行状態
2. **FxElementState** - 個別 Node の観測フェーズ

**CSS / DOM での使い分け:**
```css
/* Timeline 全体 */
fx-flow[data-fx-timeline-state="running"]

/* 個別 Node */
fx-call:state(active)
```

---

## F.4 Timeline Observer API

**現状:**

`timeline.emit` を monkey patch で差し替え。

**将来の方向性:**
```typescript
timeline.onStep((step) => {
  // observer logic
})
```

**理由:**
- emit が増えたときの対応
- 複数 observer の管理
- observer の追加/削除

---

## F.5 ExecutionId の管理（Remote）

**現状:**

ExecutionSnapshot は executionId を持たない。

**将来の方向性:**
```typescript
type ExecutionSnapshot = {
  executionId: string
  parentExecutionId?: string
  // ...
}
```

**理由:**
- suspend / resume でのネスト
- 複数 flow 並列実行
- Frontend での executionId 推測が不要

---

## F.6 Snapshot の蓄積戦略

**現状:**

全 snapshot を無限蓄積。

**将来の戦略:**

1. **Snapshot Window** - 最新 N 件のみ保持
2. **Truncate / Summarize** - 完了部分を要約
3. **Latest-Only Mode** - 各 Node の最新状態のみ
4. **Backend での要約** - Backend が要約済みを送信

**注意:**

蓄積戦略と投影戦略は独立している。
差分投影の問題ではない。

---