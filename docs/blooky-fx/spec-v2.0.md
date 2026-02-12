# blooky-fx Architecture Specification

**Version:** 2.0  
**Date:** 2026-02-03  
**Status:** 🔒 Design Freeze

---

## Document Status

This specification is **frozen** as of Version 2.0.

All design decisions are final and implementation must conform to this specification.

Changes to core semantics require a new major version.

---

## Table of Contents

### Part I: Core Concepts
1. [Overview](#1-overview)
2. [Design Philosophy](#2-design-philosophy)
3. [Core Concepts](#3-core-concepts)
4. [Terminology](#4-terminology)

### Part II: Flow Model
5. [Flow Model](#5-flow-model)
6. [Identifier Resolution](#6-identifier-resolution)
7. [Re-entrancy and Parallelism](#7-re-entrancy-and-parallelism)

### Part III: Timeline Semantics
8. [Timeline Design Principles](#8-timeline-design-principles)
9. [ExecutionStep Semantics](#9-executionstep-semantics)
10. [Timeline Invariants](#10-timeline-invariants)

### Part IV: SubTimeline & Remote
11. [SubTimeline Model](#11-subtimeline-model)
12. [Cancel Semantics](#12-cancel-semantics)
13. [Remote Flow](#13-remote-flow)

### Part V: Control Flow
14. [Control Flow Design](#14-control-flow-design)

### Part VI: DevTools & Observation
15. [Step Observation](#15-step-observation)
16. [DevTools Display Model](#16-devtools-display-model)

### Part VII: Constraints & Migration
17. [Prohibited Patterns](#17-prohibited-patterns)
18. [Migration Guide](#18-migration-guide)

### Appendices
A. [Destructive Use Cases](#appendix-a-destructive-use-cases)  
B. [Glossary](#appendix-b-glossary)  
C. [Version History](#appendix-c-version-history)

---

## 1. Overview

blooky-fx は関数型リアクティブプログラミング（FRP）の原則に基づいた、宣言的な非同期実行フレームワークです。

### Design Goals

1. **Timeline = 事実の記録者**  
   Timeline は ExecutionStep の直列化された事実であり、制御装置ではない。

2. **制御は構造で表現**  
   すべての実行制御は Fx ツリーまたは Prop で明示的に表現される。

3. **観測は特権**  
   ExecutionStep の観測は DevTools 専用の特権であり、通常のアプリケーション API には公開されない。

4. **Document Model の一貫性**  
   fx-flow / fx-yield / Remote は HTML の template / iframe / cross-origin と同じメンタルモデルを持つ。

---

## 2. Design Philosophy

### 2.1 HTML Mental Model

blooky-fx の設計は HTML / DOM のメンタルモデルと完全に整合している。

| HTML | blooky-fx | 意味 |
|------|-----------|------|
| `<template>` | `fx-flow` | 実行されない定義 |
| `template.content` | Flow definition | Template の内容 |
| `<iframe src>` | `fx.yield` | Document の生成 |
| `document` | Timeline | 実行コンテキスト |
| `browsing context` | ExecutionId | 実行の分離単位 |
| `postMessage` | return value | 値の受け渡し |
| Cross-origin | Remote | 別オリジン実行 |

---

### 2.2 Core Principles

#### Principle 1: Separation of Definition and Execution

```typescript
// Definition (Template)
const flow = fx.flow({ ... }, child);  // ← 実行されない

// Execution (Document instantiation)
fx.yield({ for: flow });  // ← ここで初めて実行
```

#### Principle 2: Document-Scoped Identity

```typescript
// Parent Document
fx.call(ref('action'), { id: 'task1' });

// Child Document
fx.yield({
  for: fx.flow({},
    fx.call(ref('action'), { id: 'task1' })  // ← 衝突しない
  )
});
```

#### Principle 3: Observation Does Not Imply Control

```
Observer (DevTools)
   ↓ (read-only)
ExecutionStep (fact)
   ↓ (immutable)
Timeline (autonomous execution)
```

---

## 3. Core Concepts

### 3.1 FxNode

実行可能な最小単位。各ノードは `execute()` メソッドで ExecutionStep を yield する。

```typescript
type FxNode =
  | FxFlowNode        // Document Template 定義
  | FxYieldNode       // Document 生成・実行委譲
  | FxSequenceNode    // 順次実行
  | FxParallelNode    // 並行実行
  | FxRaceNode        // 競合実行
  | FxCallNode        // 関数呼び出し
  | FxWaitNode        // 待機
  | FxConditionNode   // 条件分岐
  | FxSwitchNode      // 多分岐
  | FxLoopNode        // ループ
  | FxReturnNode      // 戻り値設定
  | FxNoneNode        // 空操作
```

---

### 3.2 ExecutionStep

FxNode の実行進行を表す**不変の事実**。

```typescript
type ExecutionStep = {
  phase: ExecutionPhase
  node: FxNode
  data?: unknown
  effect?: DripEffect<any>
}

type ExecutionPhase =
  | "enter"     // ノードに入った
  | "active"    // 処理を実行中
  | "suspend"   // 外部条件待ち（主権委譲）
  | "resume"    // 待ちから復帰
  | "exit"      // 正常終了
```

**重要:**

ExecutionStep は**意味論を持たない**。

実行制御・分岐・結果はすべて Fx ツリーにより決定される。

Step は「どこまで進んだか」を示すマーカーであり、**観測用の射影**である。

---

### 3.3 Timeline

ExecutionStep を順序通りに処理する責務を持つ。

```typescript
interface Timeline {
  readonly executionId: string
  emit(step: ExecutionStep): Promise<void>
  cancel(reason?: CancelReason): void
}
```

**Timeline の責務:**
- ✅ Step を順序通りに emit する
- ✅ DripEffect を適用する（exit phase のみ）
- ✅ Suspend を管理する（Prop の監視 / Child の完了待ち）

**Timeline の非責務:**
- ❌ 実行フローを外部から変更する
- ❌ Step を改変する
- ❌ FxNode の実行ロジックに介入する

---

### 3.4 DripEffect

FRP における状態更新の設計図。exit phase でのみ適用される。

```typescript
type DripEffect<A> = {
  dripper: DripperStream<A>
  value: A
  effects: Map<Prop<any>, any>
}
```

---

### 3.5 Flow (Template)

実行されない定義ノード。fx-yield により Document / Timeline が生成される。

```typescript
type FxFlowNode = FxNodeBase<"flow", {
  context: AppContext
  child: FxNode
}>
```

---

## 4. Terminology

### Core Terms

| 用語 | 定義 |
|------|------|
| **Document** | fx-flow から fx-yield により生成される、id 名前空間と実行文脈の単位 |
| **Timeline** | Document 内で発生する ExecutionStep の時系列 |
| **Execution** | Timeline が active/suspend/exit を経て完了する一連の過程 |
| **Flow** | Document を生成するための Template（fx-flow） |
| **Yield** | Flow から Document を生成し、実行を委譲する操作（fx-yield） |

### Relationships

```
Flow (Template)
 ↓ fx-yield
Document (Instance)
 ↓ contains
Timeline (Execution context)
 ↓ emits
ExecutionStep (Fact)
 ↓ observed by
DevTools (Observer)
```

---

## 5. Flow Model

### 5.1 fx-flow as Document Template

**Definition:**

`fx-flow` は実行されない定義ノードであり、Document を生成する Template である。

これは HTML における `<template>` 要素と同じ意味論を持つ。

```typescript
// fx-flow は Template
const confirmFlow = fx.flow(
  { $userInput: hold("")(inputStream$) },
  fx.sequence([
    fx.collapse("Confirm?", ref('messageStream$')),
    fx.wait({ until: ref('$userConfirmed') }),
    fx.return(ref('$userInput'))
  ]),
  { id: 'confirmFlow' }
);

// Template 自体は実行されない
// fx.yield によって初めて実行される
```

**Analogy: HTML Template**

```html
<!-- HTML -->
<template id="myTemplate">
  <div>Content</div>
</template>

<!-- JavaScript -->
const instance = template.content.cloneNode(true);
document.body.appendChild(instance);
```

```typescript
// blooky-fx
const flow = fx.flow({ ... }, child);  // Template
fx.yield({ for: flow });                // Instantiation
```

---

### 5.2 fx-yield as Document Instantiation

**Definition:**

`fx-yield` は fx-flow から新しい Document / Timeline を生成する。

これは HTML における iframe の src 指定と同じ意味論を持つ。

```typescript
// fx-yield = Document 生成
fx.parallel([
  fx.yield({ for: ref('confirmFlow') }),  // Document 1
  fx.yield({ for: ref('confirmFlow') })   // Document 2
])

// 2つの独立した Timeline が生成される
// それぞれ独立した ExecutionId と id 名前空間を持つ
```

**Analogy: iframe**

```html
<!-- HTML -->
<iframe src="page.html"></iframe>
<iframe src="page.html"></iframe>

<!-- 2つの独立した browsing context -->
```

---

### 5.3 Value Passing

**Rule:**

fx-yield は Child Timeline の exit value を自身の評価結果として Parent Timeline に返す。

```typescript
// Child Flow
const child = fx.flow(
  {},
  fx.sequence([
    fx.call(ref('process')),
    fx.return(ref('result'))  // ← この値が返される
  ])
);

// Parent Flow
fx.sequence([
  fx.yield({ for: child, id: 'childResult' }),
  fx.call(ref('useResult'), { arg: ref('#childResult') })
  // ← #childResult に Child の戻り値が入っている
]);
```

**Analogy: iframe postMessage**

```javascript
// iframe 内
window.parent.postMessage({ result: data }, '*');

// 親 window
window.addEventListener('message', (e) => {
  const result = e.data.result;  // ← 値を受け取る
});
```

---

## 6. Identifier Resolution

### 6.1 Document Scope

**Rule:**

`id` は Document 単位で一意である。

Flow 境界は iframe 境界と同等であり、id の解決範囲を分離する。

```typescript
// Parent Document
const parent = fx.flow(
  {},
  fx.sequence([
    fx.call(ref('action'), { id: 'task1' }),      // ← Parent の task1
    fx.yield({ for: ref('childFlow'), id: 'y1' })
  ])
);

// Child Document (childFlow)
const child = fx.flow(
  {},
  fx.sequence([
    fx.call(ref('action'), { id: 'task1' })       // ← Child の task1
  ])
);

// Parent の task1 と Child の task1 は別物（衝突しない）
```

---

### 6.2 Resolution Scope

```
Document (Timeline: exec-abc)
 ├─ #task1     ← この Document 内のみ有効
 ├─ #task2
 └─ fx-yield (新しい Document: exec-abc:yield-1)
     ├─ #task1  ← 別の名前空間
     └─ #task2
```

---

### 6.3 Cross-Document Reference is Prohibited

**❌ Prohibited:**

```typescript
// Parent Document
fx.sequence([
  fx.yield({ for: ref('child') }),
  fx.call(ref('useChildResult'), {
    arg: ref('#childTaskResult')  // ❌ Child の id を参照できない
  })
])
```

**✅ Correct:**

```typescript
// Parent Document
fx.sequence([
  fx.yield({ for: ref('child'), id: 'childResult' }),
  fx.call(ref('useChildResult'), {
    arg: ref('#childResult')  // ✅ yield の戻り値を参照
  })
])
```

---

### 6.4 Rationale

#### 1. iframe モデルとの整合性

```html
<!-- Parent Document -->
<div id="task1"></div>
<iframe src="child.html"></iframe>

<script>
  // ❌ iframe 内の要素に直接アクセスできない
  const childTask = document.getElementById('task1');  // ← Parent の task1
  
  // ✅ postMessage で値を受け取る
  window.addEventListener('message', (e) => {
    const result = e.data;
  });
</script>

<!-- Child Document (child.html) -->
<div id="task1"></div>  <!-- 衝突しない -->
```

#### 2. 再入可能性の保証

```typescript
fx.parallel([
  fx.yield({ for: ref('flow') }),  // Document 1: #task1
  fx.yield({ for: ref('flow') })   // Document 2: #task1
])
// 両方とも #task1 を持てる
```

#### 3. 並列実行の安全性

```typescript
// 同じ Flow から複数の Document を生成しても
// id 衝突が起きない
```

---

## 7. Re-entrancy and Parallelism

### 7.1 Re-entrancy

同じ fx-flow から複数の Timeline を生成できる。

```typescript
const flow = fx.flow({}, child);

fx.sequence([
  fx.yield({ for: flow }),  // 1回目の実行
  fx.yield({ for: flow })   // 2回目の実行（再入）
])
```

**各実行は独立:**

```
Timeline 1 (exec-abc:yield-1)
 └─ #task1 = result1

Timeline 2 (exec-abc:yield-2)
 └─ #task1 = result2

// 互いに干渉しない
```

---

### 7.2 Parallelism

同じ fx-flow から並列に Timeline を生成できる。

```typescript
fx.parallel([
  fx.yield({ for: flow }),  // 並列実行 1
  fx.yield({ for: flow }),  // 並列実行 2
  fx.yield({ for: flow })   // 並列実行 3
])

// それぞれ独立した ExecutionId を持つ:
// - exec-abc:yield-1
// - exec-abc:yield-2
// - exec-abc:yield-3
```

---

### 7.3 Independence

各 Document は完全に独立している。

```typescript
// Document 1
appContext["#task1"] = result1;

// Document 2
appContext["#task1"] = result2;

// 互いに干渉しない（別の名前空間）
```

---

## 8. Timeline Design Principles

### 8.1 Timeline is a Fact Recorder, Not a Controller

Timeline は ExecutionStep の直列化された事実である。

**Timeline の責務:**
- ✅ Step を順序通りに emit する
- ✅ DripEffect を適用する（exit phase のみ）
- ✅ Suspend を管理する（Prop の監視 / Child の完了待ち）

**Timeline の非責務:**
- ❌ 実行フローを外部から変更する
- ❌ Step を改変する
- ❌ FxNode の実行ロジックに介入する
- ❌ 未来の実行を予測する

---

### 8.2 Control Must Be Explicit in Fx Tree or Prop

実行制御は Fx ツリーまたは Prop で明示的に表現される。

#### 構造的制御（Fx ツリー）

```typescript
// 順次実行
fx.sequence([
  fx.call(ref('step1')),
  fx.call(ref('step2'))
])

// 条件分岐
fx.condition(
  ref('isValid'),
  fx.call(ref('onSuccess')),
  fx.call(ref('onError'))
)

// 並行実行
fx.parallel([
  fx.call(ref('task1')),
  fx.call(ref('task2'))
])
```

#### データ駆動制御（Prop）

```typescript
// 待機
const $userConfirmed = hold(false)(confirmStream$);
fx.wait({ until: $userConfirmed })

// ループ
const $shouldContinue = hold(true)(continueStream$);
fx.loop(
  $shouldContinue,
  fx.call(ref('processItem'))
)
```

#### ❌ 外部 Command 制御（採用しない）

```typescript
// ❌ これは提供しない
timeline.pause(executionId)
timeline.resume(executionId)
timeline.step(executionId)

// 理由:
// 1. Fx ツリーに現れない制御は再生不可能
// 2. 因果関係が追跡できない
// 3. Timeline の意味論を歪める
```

---

### 8.3 Remote Execution is Encapsulated

Remote 実行は呼び出し元の Fx ツリーに包含される。

```
Caller Fx Tree (Frontend)
 └─ fx-yield (Remote)
     └─ Remote Timeline (Backend)
```

**制御の主権:**

- Remote 側の Timeline は**自律的に進行**する
- 呼び出し元は Remote の完了を**待つ**だけ
- 外部からの pause/resume は**因果関係を断絶**させる

**正しい実装パターン:**

```typescript
// Frontend
const $remoteComplete = hold(false)(remoteCompleteStream$);

fx.sequence([
  fx.call(ref('startRemoteExecution')),  // WebSocket で開始
  fx.wait({ until: $remoteComplete }),   // 完了を待つ
  fx.call(ref('processResult'))
])

// Backend（Remote Timeline）- 独立して実行
fx.flow({},
  fx.sequence([
    fx.call(ref('fetchData')),
    fx.call(ref('processData')),
    fx.collapse(true, ref('remoteCompleteStream$'))  // 完了を通知
  ])
)
```

---

### 8.4 Cancel is an Exception

`cancel` だけは Timeline の制御として許される。

**cancel と pause/resume の違い:**

| 項目 | cancel | pause/resume |
|------|--------|--------------|
| **意味** | Document の破棄 | 実行の再編成 |
| **Fx での表現** | 不要（緊急停止） | 必須（通常制御） |
| **Replay** | 可能（停止の事実） | 不可能（原因不明） |
| **DevTools 表示** | 「強制終了」 | 「原因不明の停止」 |
| **因果関係** | 歪めない | 断絶する |

---

## 9. ExecutionStep Semantics

### 9.1 Phase Definitions

```typescript
type ExecutionPhase =
  | "enter"     // ノードに入った（まだ何もしていない）
  | "active"    // ノードの処理を実行中
  | "suspend"   // 外部条件待ち（主権委譲）
  | "resume"    // suspend から復帰した瞬間
  | "exit"      // 正常終了
```

---

### 9.2 Phase Transitions

**正常フロー（待機なし）:**
```
enter → active → exit
```

**待機あり:**
```
enter → active → suspend → resume → exit
```

**禁止される遷移:**

- ❌ `enter → exit`（active を経由しない）
- ❌ `suspend → active`（必ず resume を経由）
- ❌ `resume → suspend`（同じノードで二重 suspend）
- ❌ `exit → enter`（phase の巻き戻し）

---

### 9.3 Data Semantics

| Phase | data | effect | 備考 |
|-------|------|--------|------|
| **enter** | `undefined` | - | ノードに入った瞬間 |
| **active** | メタデータ（任意） | - | 処理実行中の情報 |
| **suspend** | `SuspendCondition`（必須） | - | 待機条件 |
| **resume** | `undefined` | - | 待機から復帰 |
| **exit** | 実行結果（任意） | `DripEffect`（任意） | 正常終了 |

**suspend の data 構造:**

```typescript
type SuspendCondition =
  | { type: "prop"; until: Prop<boolean> }       // fx-wait
  | { type: "yield"; childExecutionId: string }  // fx-yield
```

---

### 9.4 Step Immutability

**ExecutionStep は immutable**

```typescript
// ✅ 正しい: 新しい step を生成
const newStep = { ...step, phase: "exit" };

// ❌ 間違い: 既存の step を変更
step.phase = "exit";  // ❌ 禁止
```

**Observer / DevTools は read-only**

```typescript
// ✅ 正しい: 観測のみ
stepClock.observe((effect) => {
  console.log(effect.step.phase);  // ✅
});

// ❌ 間違い: step を変更
stepClock.observe((effect) => {
  effect.step.phase = "paused";  // ❌ 禁止
});
```

---

## 10. Timeline Invariants

これらの不変条件は blooky-fx の全実装で保証されなければならない。

### Invariant 1: Step Order Preservation

ExecutionStep は生成順に emit される。

```typescript
invariant: step[n].timestamp < step[n+1].timestamp
```

**違反例:**

```typescript
// ❌ step を並び替え
steps.sort((a, b) => a.priority - b.priority);

// ❌ step を skip
if (step.phase === "suspend") return;

// ❌ step を重複送信
await transport.send(step);
await transport.send(step);  // ❌
```

---

### Invariant 2: Timeline Independence

Timeline は以下のいずれにも依存しない。

```typescript
invariant: Timeline.emit() の挙動は以下に依存しない
  - Transport の存在
  - DevTools の接続状態
  - stepClock observer の有無
```

---

### Invariant 3: FxNode Ignorance

FxNode は以下を知ってはならない。

```typescript
invariant: FxNode.execute() の挙動は以下に依存しない
  - LocalTimeline か RemoteTimeline か
  - DevTools が接続しているか
  - 自分の step が観測されているか
```

---

### Invariant 4: Step Immutability

emit された ExecutionStep は変更されない。

```typescript
invariant: step は immutable
```

---

### Invariant 5: Single Effect Application Point

DripEffect は exit phase でのみ apply される。

```typescript
invariant: tick(effect) は phase === "exit" のときのみ呼ばれる
```

---

### Invariant 6: Suspend Resolution Guarantee

suspend した Step は必ず resume または cancel される。

```typescript
invariant: ∀ suspend step, ∃ (resume step ∨ cancel)
```

---

### Invariant 7: Observer Non-Interference

stepClock.observe は Timeline の進行を妨げない。

```typescript
invariant: observer が throw しても Timeline は継続する
```

---

## 11. SubTimeline Model

### 11.1 Parent-Child Relationship

**Model:**

```
Parent Timeline (Document)
 └─ fx-yield
     └─ Child Timeline (New Document)
```

**Analogy:**

```html
<!-- Parent Document -->
<body>
  <iframe src="child.html"></iframe>  ← fx-yield
</body>

<!-- Child Document (child.html) -->
<body>
  <!-- Independent document -->
</body>
```

---

### 11.2 ExecutionId Naming

**Convention:**

```typescript
Parent: exec-abc123
Child:  exec-abc123:yield-1
Child:  exec-abc123:yield-2
```

**Benefits:**

1. 親子関係が executionId から判別可能
2. DevTools で自動的にグルーピング
3. Log の追跡が容易

---

### 11.3 Suspend Semantics

**suspend は主権委譲を示す唯一の phase である。**

**fx-wait の suspend:**

```typescript
{
  phase: "suspend",
  node: waitNode,
  data: {
    condition: {
      type: "prop",
      until: $userConfirmed  // ← Prop が true になるまで待つ
    }
  }
}
```

**fx-yield の suspend:**

```typescript
{
  phase: "suspend",
  node: yieldNode,
  data: {
    condition: {
      type: "yield",
      childExecutionId: "exec-abc:yield-1"  // ← Child の完了を待つ
    }
  }
}
```

**Difference:**

| 項目 | fx-wait | fx-yield |
|------|---------|----------|
| **待つ対象** | Prop の変化 | Child Timeline の完了 |
| **主権** | 保持（自分で監視） | 委譲（Child に任せる） |
| **再開条件** | Prop === true | Child が exit |

---

## 12. Cancel Semantics

### 12.1 Cancel as Document Destruction

**Definition:**

Cancel は例外ではなく、Document の破棄（iframe removal）である。

```html
<!-- Analogy -->
<iframe id="child"></iframe>

<script>
  // iframe を削除
  document.getElementById('child').remove();
  // → Child Document は破棄される
</script>
```

---

### 12.2 Cancel Does Not Return a Value

Cancel は値を返さず、完了とは区別される終端である。

```typescript
// ✅ 正常終了: 値を返す
fx.sequence([
  fx.call(ref('process')),
  fx.return(ref('result'))  // ← 値が返る
])

// ✅ Cancel: 値を返さない
timeline.cancel("user");  // ← 終端（値なし）
```

---

### 12.3 Cancel Propagation (Mandatory)

**Rule:**

親 Timeline が cancel されたとき:

1. 全ての**実行中**の子 Timeline に cancel を伝播する
2. **完了済み**の子 Timeline には影響しない
3. **未実行**の fx-yield はスキップされる

**Example:**

```typescript
fx.sequence([
  fx.call(ref('before')),
  fx.yield({ for: ref('child1') }),  // 完了済み
  fx.yield({ for: ref('child2') }),  // 実行中 ← cancel 伝播
  fx.yield({ for: ref('child3') })   // 未実行 ← スキップ
])

// Parent.cancel("user") が呼ばれたとき:
// - child1: 影響なし（完了済み）
// - child2: cancel される
// - child3: 実行されない
```

---

### 12.4 Implementation

```typescript
class ParentTimeline {
  private activeChildren = new Map<string, Timeline>();

  cancel(reason: CancelReason) {
    this.cancelled = true;
    
    // 全ての実行中の子 Timeline に伝播
    this.activeChildren.forEach(child => {
      child.cancel(reason);
    });
    
    this.activeChildren.clear();
  }
}
```

---

## 13. Remote Flow

### 13.1 Remote as Cross-Origin iframe

**Model:**

Remote Flow は「別オリジン iframe + template」として扱われる。

```html
<!-- Analogy -->
<iframe src="https://example.com/flow.html"></iframe>
```

```typescript
// blooky-fx
fx.yield({ for: "wss://example.com/flow" })
```

---

### 13.2 URL-based Flow

**Syntax:**

```typescript
// URL を持つ fx-flow
fx.yield({ for: "wss://example.com/flows/confirm" })
```

**Protocol:**

```typescript
// 1. Template の取得（初回のみ）
GET https://example.com/flows/confirm
→ FxNodeJSON

// 2. 実行開始（WebSocket）
→ { type: "execute", flow: FxNodeJSON, context: AppContext }

// 3. 完了通知
← { type: "complete", result: any }
```

---

### 13.3 Observation Does Not Imply Control

**Critical Rule:**

Remote Timeline の ExecutionStep 観測は、実行順序・速度・分岐に影響を与えない。

```
DevTools (Frontend)
   ↓ (observe only)
Remote Timeline (Backend)
   ↓ (autonomous execution)
ExecutionStep
```

**DevTools ができること:**
- ✅ Step を観測
- ✅ 表示・ログ・デバッグ

**DevTools ができないこと:**
- ❌ 実行を pause
- ❌ step を変更
- ❌ Remote Timeline を制御

---

### 13.4 Remote Timeline Adapter

**Interface:**

```typescript
interface RemoteTimelineAdapter {
  // Template の取得
  getFlow(url: string): Promise<FxNode>
  
  // 実行開始
  execute(flow: FxNode, context: AppContext): Promise<string>
  
  // 完了待ち
  waitForCompletion(executionId: string): Promise<any>
  
  // 観測（DevTools 専用）
  attach(executionId: string): void
  detach(executionId: string): void
  onStep(handler: (step: ExecutionStepJSON) => void): void
  
  // cancel（必須）
  cancel(executionId: string, reason?: CancelReason): void
}
```

---

## 14. Control Flow Design

### 14.1 Two Types of Control

blooky-fx における制御は 2 種類のみ。

#### Structural Control（構造的制御）

Fx ツリーの構造として表現される制御。

```typescript
fx.sequence([step1, step2])
fx.parallel([task1, task2])
fx.race([fast, slow])
fx.condition(test, thenBranch, elseBranch)
fx.switch(value, cases)
fx.loop(cond, body)
```

#### Data-Driven Control（データ駆動制御）

Prop の値変化によって制御される。

```typescript
fx.wait({ until: $userConfirmed })
fx.loop($shouldContinue, body)
fx.switch($branchKey, cases)
```

#### ❌ Command Control（採用しない）

```typescript
// ❌ これらは提供しない
timeline.pause()
timeline.resume()
timeline.step()
```

---

### 14.2 External Input Integration

外部入力（HTTP / WebSocket / UI Event）は Stream → Prop として注入される。

```typescript
// 1. Stream を定義
const pauseRequest$ = stream<boolean>();

// 2. Prop に変換
const $pauseRequested = hold(false)(pauseRequest$);

// 3. Fx で参照
fx.sequence([
  fx.call(ref('doWork')),
  fx.wait({ until: $pauseRequested }),  // ← Prop を監視
  fx.call(ref('continueWork'))
])

// 4. 外部から値を注入
button.onclick = () => {
  collapse(drip(true)(pauseRequest$));
};
```

---

## 15. Step Observation

### 15.1 stepClock API

```typescript
type StepClockEffect = {
  step: ExecutionStep
  executionId: string
  unbind: (node: FxNode) => void
}

export const stepClock = {
  observe: (
    f: (effect: StepClockEffect) => void
  ) => (node: FxNode) => () => void
  
  unobserve: (
    f: (effect: StepClockEffect) => void
  ) => (node?: FxNode) => void
}
```

---

### 15.2 Performance Characteristics

#### DevTools なし（prod）

```typescript
async emit(step: ExecutionStep) {
  if (stepObservers.size === 0) {
    // ← ここで終了（コスト: Map.size のみ）
  }
  
  // 本来の処理
}
```

**コスト:** `Map.size` のチェック（< 1ns）

#### DevTools あり（dev）

**コスト:** observer 数 × `Set.has()` + DOM 更新

---

## 16. DevTools Display Model

### 16.1 Nested View (Primary)

```
Parent Timeline (exec-abc)
├─ fx-call: before (completed)
├─ fx-yield: subFlow (suspend)
│   └─ Child Timeline (exec-abc:yield-1)
│       ├─ fx-call: remote1 (completed)
│       └─ fx-call: remote2 (active)
└─ fx-call: after (pending)
```

---

### 16.2 Link View (Secondary)

```
Parent Timeline (exec-abc)
├─ fx-yield → Child (exec-abc:yield-1) [Open in new window]
```

---

## 17. Prohibited Patterns

### 17.1 FxNode Constraints

```typescript
// ❌ Timeline の存在を仮定
class BadNode {
  async *execute(ctx) {
    ctx.timeline.pause();  // ❌
  }
}

// ✅ Timeline を知らない
class GoodNode {
  async *execute(ctx) {
    yield { phase: "enter", node: ctx.node };
    yield { phase: "exit", node: ctx.node };
  }
}
```

---

### 17.2 DevTools Constraints

```typescript
// ❌ Step を変更
const badObserver = (effect) => {
  effect.step.phase = "paused";  // ❌
};

// ✅ Read-only
const goodObserver = (effect) => {
  console.log(effect.step.phase);  // ✅
};
```

---

### 17.3 Transport Constraints

```typescript
// ❌ Step を破棄
class BadTransport {
  async send(step) {
    if (step.phase === "suspend") return;  // ❌
  }
}

// ✅ 順序を保持
class GoodTransport {
  async send(step) {
    await this.ws.send(step);  // ✅
  }
}
```

---

### 17.4 DOM-like Anti-patterns

**❌ Prohibited:**

- Cross-Document id reference
- Parent Timeline mutating Child context
- ExecutionStep を制御信号として扱う実装
- Remote Timeline の内部状態への直接操作

---

## 18. Migration Guide

### 18.1 fx-context → fx-flow

**Rationale:**

- より明確に「実行可能な定義」を表現
- fx-yield との対応が自然
- HTML template との類推が明確

**Changes:**

| Before | After |
|--------|-------|
| `fx.context(ctx, child, id)` | `fx.flow(ctx, child, id)` |
| `FxContextNode` | `FxFlowNode` |
| `<fx-context>` | `<fx-flow>` |

---

### 18.2 Deprecated APIs

#### fx-context

**Status:** Deprecated in v2.0, will be removed in v3.0

**Replacement:** `fx.flow`

---

## Appendix A: Destructive Use Cases

（前回の内容をそのまま）

---

## Appendix B: Glossary

| 用語 | 定義 |
|------|------|
| **FxNode** | 実行可能な最小単位。execute() で ExecutionStep を yield する。 |
| **ExecutionStep** | FxNode の実行進行を表す不変の事実。 |
| **Timeline** | ExecutionStep を順序通りに処理する責務を持つ。 |
| **DripEffect** | FRP における状態更新の設計図。exit phase でのみ適用される。 |
| **Prop** | 時変値を返す関数。FRP の基本単位。 |
| **Stream** | Prop への値の流れを表現。Dripper から始まる。 |
| **stepClock** | ExecutionStep の観測機構。clock の対称概念。 |
| **DevTools** | ExecutionStep を観測する特権的なツール。 |
| **Document** | fx-flow から fx-yield により生成される、id 名前空間と実行文脈の単位。 |
| **Flow** | Document を生成するための Template。 |
| **Yield** | Flow から Document を生成し、実行を委譲する操作。 |

---

## Appendix C: Version History

| Version | Date | Changes |
|---------|------|---------|
| **2.0** | 2026-02-03 | Design Freeze: Flow Model 確定、fx-context → fx-flow、SubTimeline Model、Remote Flow |
| **1.0** | 2026-02-03 | 初版リリース |

---

**END OF SPECIFICATION**