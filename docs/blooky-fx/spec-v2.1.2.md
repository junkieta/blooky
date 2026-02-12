# SPEC v2.1.2 完全版

**Version:** 2.1.2  
**Date:** 2026-02-04  
**Status:** 🔒 Design Freeze  
**Type:** Architectural Refinement + cancel semantics

---

## Document Status

This specification is **frozen** as of Version 2.1.2.

All design decisions are final and implementation must conform to this specification.

Changes to core semantics require a new major version.

---

## Summary of Changes (v2.1.2)

### Added
1. **FxCallResult** - fx-call 専用の Result 型
2. **cancel phase** - Timeline 破棄の構造イベント
3. **Output Binding Pattern** - fx-call.done / fx-yield.done
4. **Flow exit value = undefined** - fx-return がない場合のデフォルト
5. **Effect Singularity Constraint** - exit phase で最大1個の effect
6. **LocalTimeline Implementation Specification** - Child 管理の詳細
7. **Runner Specification** - Child Flow 実行の orchestration

### Removed
1. **FxCollapseNode** (Breaking) - Output Binding Pattern で代替

### Prohibited
1. **fx-return.done** (Explicit) - Flow 境界ノードに Binding は不適切
2. **throw 再伝播** - エラーは値であり制御例外ではない
3. **unwrap ユーティリティ** - collapse 再発の危険

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

### Part V: Control Flow & Error Handling
14. [Control Flow Design](#14-control-flow-design)
15. [Error Handling (FxCallResult)](#15-error-handling-fxcallresult)

### Part VI: Implementation
16. [LocalTimeline Implementation](#16-localtimeline-implementation)
17. [Runner Specification](#17-runner-specification)
18. [Output Binding Pattern](#18-output-binding-pattern)

### Part VII: DevTools & Observation
19. [Step Observation](#19-step-observation)
20. [DevTools Display Model](#20-devtools-display-model)

### Part VIII: Constraints & Migration
21. [Prohibited Patterns](#21-prohibited-patterns)
22. [Migration Guide](#22-migration-guide)

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
| `iframe.remove()` | `timeline.cancel()` | Document の破棄 |

---

### 2.2 Core Principles

#### Principle 1: Separation of Definition and Execution

```typescript
// Definition (Template)
const flow = fx.flow({ ... }, child)  // ← 実行されない

// Execution (Document instantiation)
fx.yield({ for: flow })  // ← ここで初めて実行
```

#### Principle 2: Document-Scoped Identity

```typescript
// Parent Document
fx.call(ref('action'), { id: 'task1' })

// Child Document
fx.yield({
  for: fx.flow({},
    fx.call(ref('action'), { id: 'task1' })  // ← 衝突しない
  )
})
```

#### Principle 3: Observation Does Not Imply Control

```
Observer (DevTools)
   ↓ (read-only)
ExecutionStep (fact)
   ↓ (immutable)
Timeline (autonomous execution)
```

#### Principle 4: Error is a Value, Not Control

```typescript
// ✅ Error as value
const result: FxCallResult<T> = { ok: false, error }

// ❌ Error as control (prohibited)
throw result.error
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

**Removed in v2.1:**
- ~~`FxCollapseNode`~~ - Replaced by Output Binding Pattern

---

### 3.2 ExecutionStep

FxNode の実行進行を表す**不変の事実**。

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

---

**Effect Singularity Constraint (v2.1.2):**

A single FxNode may emit **at most one effect** on exit.

```typescript
// ✅ Correct: 単一の effect
yield {
  phase: "exit",
  node,
  data: result,
  effect: drip(result)(stream$)  // ← 1個のみ
}

// ❌ Prohibited: 複数の effect
yield {
  phase: "exit",
  node,
  data: result,
  effect: [
    drip(value1)(stream1$),  // ❌
    drip(value2)(stream2$)   // ❌
  ]
}
```

**Rationale:**

1. **単一責任の原則** - 各 Node は1つの値を生成する
2. **Timeline の apply ロジックがシンプル** - `if (effect) await tick(effect)` だけで済む
3. **collapse 的ノードの再発を防止** - 複数 effect = 複数の副作用 = collapse と同じ

---

### 3.3 FxCallResult (v2.1.2)

**Definition:**

fx-call の実行結果を表す型。関数実行の成功/失敗という計算的事実を表現する。

```typescript
export type FxCallResult<T = any> = 
  | { ok: true; value: T }
  | { ok: false; error: unknown }

// 唯一のユーティリティ
export function isCallOk<T>(
  result: FxCallResult<T>
): result is { ok: true; value: T } {
  return result.ok === true
}
```

---

**PHILOSOPHY:**

fx-call は **FRP 世界から外界へ出るための唯一の穴** である。

```
┌─────────────────────────────────┐
│ FRP World                       │
│                                 │
│  Prop / Stream / DripEffect     │
│                                 │
│  ┌──────────────────┐          │
│  │   fx-call        │          │
│  │  (唯一の穴)       │──────────┼──→ 外界
│  └──────────────────┘          │   (API / IO / System)
│                                 │
│  ← FxCallResult (観測結果)      │
│                                 │
└─────────────────────────────────┘
```

- API / IO / System / Browser
- 成功も失敗も、**外界の観測結果**
- 作用は「失敗した」という事実を返すだけでよい
- 「世界を壊す権利（throw）」は持たない

---

**IMPORTANT:**

FxCallResult は **fx-call 専用** である。

以下には適用しない:
- ❌ fx-yield（構造レイヤー）
- ❌ cancel / system error（カテゴリが違う）
- ❌ Remote Timeline（シリアライズ不可）

**fx-call は常に exit phase に到達する。**

エラー時も throw せず、`{ ok: false, error }` を返す。

---

**Usage:**

```typescript
// Success
const result: FxCallResult<number> = { ok: true, value: 42 }

// Error
const result: FxCallResult<number> = { ok: false, error: new Error("Failed") }

// Type guard
if (isCallOk(result)) {
  console.log(result.value)  // ← type narrowing
} else {
  console.log(result.error)
}
```

---

**Error Handling Pattern:**

```typescript
fx.sequence([
  // 1. Call（エラーも値として返る）
  fx.call(ref('compute'), {
    args: { x: ref('10') },
    id: 'result'
  }),
  
  // 2. 分岐で処理
  fx.condition(
    (ctx) => isCallOk(ctx['#result']),
    fx.call(ref('onSuccess'), { args: { value: ref('getResultValue') } }),
    fx.call(ref('onError'), { args: { error: ref('getResultError') } })
  )
])
```

---

**Prohibited Patterns:**

```typescript
// ❌ throw 再伝播（二重表現）
if (!result.ok) {
  throw result.error  // ❌ エラーは値、制御例外ではない
}

// ❌ unwrap（error 隠蔽）
unwrap(result)  // ❌ collapse 再発の危険

// ❌ callOk / callErr ヘルパー（不要な糖衣）
callOk(42)  // ❌ { ok: true, value: 42 } で十分

// ❌ 全ノードに適用
type FxNode = {
  execute(): AsyncGenerator<ExecutionStep, FxResult<T>, any>
}

// ❌ fx-yield に適用
fx.yield({ for: ref('flow') })
// → FxCallResult を返す（禁止）
```

---

**Rationale:**

1. **エラーは値であり制御ではない**
   - throw しない
   - Timeline の責務を守る
   - 命令的世界観への逆流を防ぐ

2. **Timeline はエラーを知らない**
   ```typescript
   yield {
     phase: "exit",
     node,
     data: { ok: false, error }  // ← 記録（制御ではない）
   }
   ```

3. **分岐は明示的**
   ```typescript
   fx.condition(
     (ctx) => isCallOk(ctx['#result']),
     thenBranch,
     elseBranch
   )
   ```

4. **ヘルパーは最小**
   - `isCallOk` のみ提供
   - `callOk` / `callErr` / `unwrap` は不要

---

### 3.4 Timeline

ExecutionStep を順序通りに処理する責務を持つ。

```typescript
interface Timeline {
  readonly executionId: string
  emit(step: ExecutionStep): Promise<void>
  cancel(reason?: CancelReason): void
  isCancelled(): boolean
}
```

**Timeline の責務:**
- ✅ Step を順序通りに emit する
- ✅ DripEffect を適用する（exit phase のみ）
- ✅ Suspend を管理する（Prop の監視 / Child の完了待ち）
- ✅ cancel を子に伝播する

**Timeline の非責務:**
- ❌ 実行フローを外部から変更する
- ❌ Step を改変する
- ❌ FxNode の実行ロジックに介入する

---

### 3.5 DripEffect

FRP における状態更新の設計図。exit phase でのみ適用される。

```typescript
type DripEffect<A> = {
  dripper: DripperStream<A>
  value: A
  effects: Map<Prop<any>, any>
}
```

---

### 3.6 Flow (Template)

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
| **Runner** | Child Flow の実行を orchestrate する責務を持つ |
| **cancel** | Timeline の破棄（iframe removal と同義） |

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
    fx.wait({ until: ref('$userConfirmed') }),
    fx.return(ref('$userInput'))
  ]),
  { id: 'confirmFlow' }
)

// Template 自体は実行されない
// fx.yield によって初めて実行される
```

---

### 5.2 fx-yield as Document Instantiation

**Definition:**

`fx.yield` は fx-flow から新しい Document / Timeline を生成する。

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

---

### 5.3 Value Passing

**Rule:**

fx-yield は Child Timeline の exit value を自身の評価結果として Parent Timeline に返す。

**If a Flow exits without fx-return, its exit value is `undefined`.** (v2.1.2)

```typescript
// Case 1: fx-return あり
const flow1 = fx.flow({},
  fx.sequence([
    fx.call(ref('process')),
    fx.return(ref('result'))  // ← この値が返される
  ])
)

// Case 2: fx-return なし
const flow2 = fx.flow({},
  fx.sequence([
    fx.call(ref('process'))
    // ← exit value は undefined
  ])
)

// Case 3: 空の Flow
const flow3 = fx.flow({}, fx.none())
// ← exit value は undefined
```

**Rationale:**

1. **fx-return の存在意義が明確**
   - return がなければ値は返らない
   - 明示的に値を返すノード

2. **undefined = 値がない**
   - null とは異なる（null は明示的な値）
   - undefined = Flow は完了したが値を返さなかった

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
)

// Child Document (childFlow)
const child = fx.flow(
  {},
  fx.sequence([
    fx.call(ref('action'), { id: 'task1' })       // ← Child の task1
  ])
)

// Parent の task1 と Child の task1 は別物（衝突しない）
```

---

## 7. Re-entrancy and Parallelism

### 7.1 Re-entrancy

同じ fx-flow から複数の Timeline を生成できる。

```typescript
const flow = fx.flow({}, child)

fx.sequence([
  fx.yield({ for: flow }),  // 1回目の実行
  fx.yield({ for: flow })   // 2回目の実行（再入）
])
```

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

## 8. Timeline Design Principles

### 8.1 Timeline is a Fact Recorder, Not a Controller

Timeline は ExecutionStep の直列化された事実である。

**Timeline の責務:**
- ✅ Step を順序通りに emit する
- ✅ DripEffect を適用する（exit phase のみ）
- ✅ Suspend を管理する（Prop の監視 / Child の完了待ち）
- ✅ cancel を子に伝播する

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
fx.sequence([...])
fx.parallel([...])
fx.condition(test, then, else)
```

#### データ駆動制御（Prop）

```typescript
fx.wait({ until: $userConfirmed })
fx.loop($shouldContinue, body)
```

#### ❌ 外部 Command 制御（採用しない）

```typescript
// ❌ これは提供しない
timeline.pause(executionId)
timeline.resume(executionId)
```

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
  | "cancel"    // 破棄（v2.1.2）
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

**cancel:**
```
enter → active → cancel
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
| **cancel** | `{ reason: CancelReason }` | - | 破棄 |

**suspend の data 構造:**

```typescript
type SuspendCondition =
  | { type: "prop"; until: Prop<boolean> }       // fx-wait
  | { type: "yield"; childExecutionId: string }  // fx-yield
```

---

## 10. Timeline Invariants

これらの不変条件は blooky-fx の全実装で保証されなければならない。

### Invariant 1: Step Order Preservation

ExecutionStep は生成順に emit される。

```typescript
invariant: step[n].timestamp < step[n+1].timestamp
```

### Invariant 2: Timeline Independence

Timeline は以下のいずれにも依存しない。

```typescript
invariant: Timeline.emit() の挙動は以下に依存しない
  - Transport の存在
  - DevTools の接続状態
  - stepClock observer の有無
```

### Invariant 3: FxNode Ignorance

FxNode は以下を知ってはならない。

```typescript
invariant: FxNode.execute() の挙動は以下に依存しない
  - LocalTimeline か RemoteTimeline か
  - DevTools が接続しているか
  - 自分の step が観測されているか
```

### Invariant 4: Step Immutability

emit された ExecutionStep は変更されない。

```typescript
invariant: step は immutable
```

### Invariant 5: Single Effect Application Point

DripEffect は exit phase でのみ apply される。

```typescript
invariant: tick(effect) は phase === "exit" のときのみ呼ばれる
```

### Invariant 6: Suspend Resolution Guarantee

suspend した Step は必ず resume または cancel される。

```typescript
invariant: ∀ suspend step, ∃ (resume step ∨ cancel)
```

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

---

## 12. Cancel Semantics

### 12.1 Cancel as Document Destruction

**Definition:**

cancel は Timeline の破棄を表す構造イベントである。

これは iframe の remove と同じ意味論を持つ。

```html
<!-- Analogy -->
<iframe id="child"></iframe>

<script>
  // iframe を削除
  document.getElementById('child').remove()
  // → Child Document は破棄される
</script>
```

---

### 12.2 cancel phase (v2.1.2)

```typescript
type ExecutionPhase =
  | "enter"
  | "active"
  | "suspend"
  | "resume"
  | "exit"
  | "cancel"  // ← NEW

type CancelReason =
  | "user"      // ユーザーによる明示的な cancel
  | "parent"    // 親 Timeline の cancel による伝播
  | "timeout"   // タイムアウト
  | "system"    // システムエラー
```

---

### 12.3 Characteristics

**1. cancel は値ではない**

```typescript
// ❌ Prohibited
return { ok: false, error: "cancelled" }
drip(cancel)(stream)
```

**2. cancel は effect を持たない**

```typescript
{
  phase: "cancel",
  node: { type: "__timeline__" },
  data: { reason: "user" },
  effect: undefined  // ← 常に undefined
}
```

**3. cancel 後の step は無視される**

```typescript
if (this.cancelled) {
  stepTick(step, this.executionId, { ignored: true })
  return  // ← throw しない
}
```

---

### 12.4 Propagation Rule (Mandatory)

親 Timeline が cancel されたとき、全ての実行中の子 Timeline に cancel を伝播する。

```typescript
cancel(reason: CancelReason): void {
  this.cancelled = true
  
  // cancel step を記録
  this.root.steps.push({ phase: "cancel", node, data: { reason } })
  
  // 子に伝播
  for (const childTimeline of this.childTimelines.values()) {
    childTimeline.cancel(reason)
  }
}
```

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

### 12.5 Observable Behavior

```
Parent Timeline
├─ fx-yield (suspend)
│   └─ Child Timeline
│       ├─ fx-call (enter)
│       ├─ fx-call (active)
│       └─ cancel (reason: "parent")  ← 伝播
└─ cancel (reason: "user")
```

**NOTE:**
- resume / exit が emit されない
- 「途中で消えた」ことがそのまま見える
- iframe removal と同じ意味論

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

### 13.2 Observation Does Not Imply Control

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
```

#### Data-Driven Control（データ駆動制御）

Prop の値変化によって制御される。

```typescript
fx.wait({ until: $userConfirmed })
fx.loop($shouldContinue, body)
```

#### ❌ Command Control（採用しない）

```typescript
// ❌ これらは提供しない
timeline.pause()
timeline.resume()
```

---

## 15. Error Handling (FxCallResult)

### 15.1 Layer Separation

**Layer 1: FxNode（計算レイヤー）**

```typescript
// fx-call は FxCallResult を返す
type FxCallResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown }
```

**✅ FxResult はここでのみ導入**

**理由:**
- 関数実行の成功/失敗という**計算的事実**
- ローカルで完結
- シリアライズ不要

---

**Layer 2: Flow / Yield（構造レイヤー）**

```typescript
// fx-yield は従来通り
type YieldExitValue = any | undefined

// cancel / disconnect は値ではない
```

**❌ FxResult の自動適用は禁止**

**理由:**
- yield = 主権委譲（値ではない）
- cancel = Document 破棄（値ではない）
- error とは**カテゴリが違う**

---

**Layer 3: Timeline（実行基盤）**

```typescript
// Timeline は throw しない
// error は Step data として記録されるだけ
yield {
  phase: "exit",
  node,
  data: { ok: false, error }  // ← 記録（制御ではない）
}
```

---

### 15.2 Error Handling Pattern

```typescript
fx.sequence([
  // 1. Call で計算（エラーも値として返る）
  fx.call(ref('compute'), {
    args: { x: ref('10') },
    id: 'result'
  }),
  
  // 2. 分岐で処理
  fx.condition(
    (ctx) => isCallOk(ctx['#result']),
    
    // 成功時
    fx.call(ref('onSuccess'), {
      args: { value: (ctx) => ctx['#result'].value }
    }),
    
    // エラー時
    fx.call(ref('onError'), {
      args: { error: (ctx) => ctx['#result'].error }
    })
  )
])
```

---

## 16. LocalTimeline Implementation

### 16.1 Data Structure

```typescript
export type TimelineNode = {
  executionId: string
  steps: ExecutionStep[]
  children: Map<string, TimelineNode>
}

export class LocalTimeline implements Timeline {
  readonly executionId: string
  readonly root: TimelineNode
  
  private cancelled = false
  private childTimelines = new Map<string, LocalTimeline>()
  
  constructor(executionId: string) {
    this.executionId = executionId
    this.root = {
      executionId,
      steps: [],
      children: new Map()
    }
  }
}
```

---

### 16.2 Step Processing

```typescript
async emit(step: ExecutionStep): Promise<void> {
  // cancel 後の step は静かに無視
  if (this.cancelled) {
    stepTick(step, this.executionId, { ignored: true })
    return
  }

  // step を記録
  this.root.steps.push(step)

  // suspend の観測（登録のみ）
  if (step.phase === "suspend") {
    this.handleSuspend(step)
  }

  // Effect 適用（exit phase のみ）
  if (step.phase === "exit" && step.effect) {
    await tick(step.effect)
  }

  // Observer 通知
  stepTick(step, this.executionId)
}
```

---

### 16.3 Suspend Handling

```typescript
private handleSuspend(step: ExecutionStep): void {
  const condition = step.data?.condition
  if (!condition || condition.type !== "yield") return

  const { childExecutionId } = condition

  // Child Timeline ノードを作る（登録のみ）
  if (!this.root.children.has(childExecutionId)) {
    this.root.children.set(childExecutionId, {
      executionId: childExecutionId,
      steps: [],
      children: new Map()
    })
  }
}
```

**NOTE:**

suspend = 「これから Child がぶら下がる」という宣言。

ここでは何も起こさない（実行制御はしない）。

---

### 16.4 Cancel Implementation

```typescript
cancel(reason: CancelReason = "parent"): void {
  if (this.cancelled) return
  
  this.cancelled = true

  // cancel step を記録
  const cancelStep: ExecutionStep = {
    phase: "cancel",
    node: { type: "__timeline__" } as any,
    data: { reason }
  }

  this.root.steps.push(cancelStep)
  stepTick(cancelStep, this.executionId)

  // 子 Timeline に伝播
  for (const childTimeline of this.childTimelines.values()) {
    childTimeline.cancel(reason)
  }

  this.childTimelines.clear()
}
```

---

### 16.5 Child Timeline Management

```typescript
// Runner から呼ばれる（cancel 伝播のため）
registerChildTimeline(
  childExecutionId: string,
  childTimeline: LocalTimeline
): void {
  this.childTimelines.set(childExecutionId, childTimeline)
}

unregisterChildTimeline(childExecutionId: string): void {
  this.childTimelines.delete(childExecutionId)
}
```

**NOTE:**

これは「制御」ではなく「破棄の伝播」のために必要。

---

## 17. Runner Specification

### 17.1 Responsibilities

Runner は Child Flow の実行を orchestrate する。

**責務:**
- Child Context の生成
- Child Timeline の生成
- Child Flow を最後まで実行
- exit value を返す

**非責務:**
- 値の解釈
- エラーハンドリング（throw しない）
- cancel の判断

---

### 17.2 Implementation

```typescript
export class FxRunner {
  private timeline: Timeline

  constructor(timeline: Timeline) {
    this.timeline = timeline
  }

  async runChildFlow(
    flow: FxFlow,
    input: any,
    childExecutionId: string
  ): Promise<any> {
    // 1. Child Context 生成
    const childContext: AppContext = {
      ...flow.context,
      $_: input
    }

    // 2. Child Timeline 生成
    const childTimeline = new LocalTimeline(childExecutionId)

    // 3. 親に Child Timeline を登録
    if (this.timeline instanceof LocalTimeline) {
      this.timeline.registerChildTimeline(childExecutionId, childTimeline)
    }

    // 4. Child ExecutionContext 生成
    const childCtx: ExecutionContext = {
      node: flow.child,
      appContext: childContext,
      resolve: (ref) => () => this.resolveRef(ref, childContext),
      executionId: childExecutionId,
      runChildFlow: this.runChildFlow.bind(this),
      timeline: childTimeline
    }

    // 5. Child 実行（cancel チェック付き）
    try {
      for await (const step of flow.child.execute(childCtx)) {
        if (childTimeline.isCancelled()) {
          break  // ← throw しない
        }
        
        await childTimeline.emit(step)
      }
    } finally {
      // 6. 親から Child Timeline を削除
      if (this.timeline instanceof LocalTimeline) {
        this.timeline.unregisterChildTimeline(childExecutionId)
      }
    }

    // 7. exit value を返す
    return childContext[RETURN_VALUE] ?? undefined
  }
}
```

---

### 17.3 Execution Flow

```
fx-yield.execute()
   ↓
   suspend (宣言)
   ↓
LocalTimeline.emit(suspend)
   ↓
   何もしない（登録のみ）
   ↓
Runner.runChildFlow()
   ↓
   child.execute()
   ↓
childTimeline.emit(step...)
   ↓
child exit
   ↓
fx-yield resume
   ↓
fx-yield exit
```

**誰もやりすぎていない:**
- fx-yield = 構造境界
- Timeline = 記録のみ
- Runner = 実行のみ

---

## 18. Output Binding Pattern

### 18.1 Principle

FxNode から FRP への値の反映は、`done` 属性による Binding を通じてのみ行われる。

Node は値を `return` するだけであり、Timeline が `effect` として apply する。

---

### 18.2 Supported Nodes

| Node | Output | Binding | Purpose |
|------|--------|---------|---------|
| `fx-call` | 関数の戻り値 | `done?: FxRef<DripperStream<T>>` | 関数実行 + Stream 接続 |
| `fx-yield` | Child の exit value | `done?: FxRef<DripperStream<T>>` | Document 生成 + Stream 接続 |
| `fx-return` | 明示的な値 | （親が受け取る） | Flow の戻り値設定 |

---

### 18.3 Implementation Pattern

```typescript
// Node の execute() 内
async *execute(ctx: ExecutionContext) {
  yield { phase: "enter", node: ctx.node }
  
  // 1. 値を生成（ノード固有の処理）
  const result = /* ... */
  
  // 2. Binding（done が指定されている場合のみ）
  let effect: DripEffect<any> | undefined
  if (node.done) {
    const stream = resolve(node.done)()
    effect = drip(result)(stream)
  }
  
  // 3. Exit with effect
  yield {
    phase: "exit",
    node: ctx.node,
    data: result,
    effect  // ← Timeline が apply
  }
  
  return result
}
```

---

### 18.4 fx-call Example

```typescript
const resultStream$ = stream<FxCallResult<number>>()

fx.call(ref('compute'), {
  args: { x: ref('10') },
  done: ref('resultStream$'),  // ← 戻り値を Stream に流す
  id: 'computed'
})

// Timeline が exit phase で tick(effect) を呼ぶ
// → resultStream$ に値が流れる
```

---

### 18.5 fx-yield Example

```typescript
const statusStream$ = stream<string>()

fx.yield({
  for: ref('processFlow'),
  value: ref('#data'),
  done: ref('statusStream$'),  // ← 処理結果を Stream に流す
  id: 'processed'
})

// Child Timeline の exit value が statusStream$ に流れる
```

---

### 18.6 Rationale

**1. 責務の分離**

```
Node        → 値を生成（純粋）
Timeline    → effect を apply（副作用）
Stream      → 値を受け取る（反応）
```

**2. 統一性**

すべての FRP 接続が `done` 属性で表現される。

```typescript
// ✅ 統一されたパターン
fx.call({ done: stream$ })
fx.yield({ done: stream$ })

// ❌ バラバラなパターン（v2.0）
fx.collapse(value, stream$)  // 削除済み
```

**3. collapse の再発防止**

Node が Stream に直接書き込むことを構造的に禁止。

---

## 19. Step Observation

### 19.1 stepClock API

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

### 19.2 Performance Characteristics

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

---

## 20. DevTools Display Model

### 20.1 Nested View (Primary)

```
Parent Timeline (exec-abc)
├─ fx-call: before (completed)
├─ fx-yield: subFlow (suspend)
│   └─ Child Timeline (exec-abc:yield-1)
│       ├─ fx-call: remote1 (completed)
│       └─ fx-call: remote2 (active)
└─ fx-call: after (pending)
```

### 20.2 Cancel Visualization

```
Parent Timeline (exec-abc)
├─ fx-sequence (enter)
│   ├─ fx-yield: childFlow (enter)
│   ├─ fx-yield: childFlow (suspend)
│   │   └─ Child Timeline (exec-abc:child)
│   │       ├─ fx-call: compute (enter)
│   │       ├─ fx-call: compute (active)
│   │       └─ cancel (reason: "user")  ← cancel が見える
│   └─ cancel (reason: "user")
```

---

## 21. Prohibited Patterns

### 21.1 FxNode Constraints

```typescript
// ❌ Timeline の存在を仮定
class BadNode {
  async *execute(ctx) {
    ctx.timeline.pause()  // ❌
  }
}

// ✅ Timeline を知らない
class GoodNode {
  async *execute(ctx) {
    yield { phase: "enter", node: ctx.node }
    yield { phase: "exit", node: ctx.node }
  }
}
```

---

### 21.2 Binding Constraints

**fx-return に done は禁止:**

```typescript
// ❌ Prohibited
fx.return(ref('result'), {
  done: ref('completionStream$')  // ❌ 禁止
})

// ✅ Correct: 親の fx-yield で done を指定
fx.yield({
  for: ref('flowWithReturn'),
  done: ref('completionStream$')  // ✅ 正しい
})
```

**Rationale:**

1. fx-return は Flow 境界ノード（Binding Node ではない）
2. done を付けると collapse が復活する
3. 正しい出口は fx-yield の done

---

### 21.3 Node 内での Stream 直接操作の禁止

```typescript
// ❌ Node 内で Stream に直接書き込み
class BadNode {
  async *execute(ctx) {
    const stream = ctx.appContext['myStream$']
    stream.drip(value)  // ❌ 禁止
    
    yield { phase: "exit", node: ctx.node }
  }
}

// ✅ effect として返す
class GoodNode {
  async *execute(ctx) {
    const stream = resolve(node.done)()
    const effect = drip(value)(stream)
    
    yield {
      phase: "exit",
      node: ctx.node,
      effect  // ✅ Timeline が apply
    }
  }
}
```

---

### 21.4 複数 effect の禁止

```typescript
// ❌ 複数の effect を返す
yield {
  phase: "exit",
  node,
  effect: [
    drip(value1)(stream1$),  // ❌
    drip(value2)(stream2$)   // ❌
  ]
}

// ✅ 親ノードで分割
fx.sequence([
  fx.call(ref('fn1'), { done: ref('stream1$') }),
  fx.call(ref('fn2'), { done: ref('stream2$') })
])
```

---

### 21.5 cancel Constraints

```typescript
// ❌ cancel を値にする
yield {
  phase: "exit",
  node,
  data: { cancelled: true }  // ❌
}

// ❌ cancel を Result に入れる
return { ok: false, error: "cancelled" }  // ❌

// ❌ cancel を Stream に流す
drip(cancel)(stream)  // ❌

// ❌ cancel を例外として扱う
try {
  await runChildFlow(...)
} catch (CancelError) {  // ❌
  // ...
}
```

---

## 22. Migration Guide

### 22.1 fx-context → fx-flow

**Status:** Deprecated in v2.0, will be removed in v3.0

**Replacement:** `fx.flow`

| Before | After |
|--------|-------|
| `fx.context(ctx, child, id)` | `fx.flow(ctx, child, id)` |
| `FxContextNode` | `FxFlowNode` |
| `<fx-context>` | `<fx-flow>` |

---

### 22.2 FxCollapseNode

**Status:** ❌ **Removed in v2.1** (Breaking Change)

**Replacement:** Output Binding Pattern (`done` attribute)

**Migration:**

```typescript
// Before (v2.0)
fx.sequence([
  fx.call(ref('compute')),
  fx.collapse(ref('result'), ref('resultStream$'))  // ❌ Removed
])

// After (v2.1)
fx.call(ref('compute'), {
  done: ref('resultStream$')  // ✅ Use done attribute
})
```

---

## Appendix A: Destructive Use Cases

（前回の内容を継承）

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
| **Runner** | Child Flow の実行を orchestrate する責務を持つ。 |
| **cancel** | Timeline の破棄。iframe removal と同義。 |
| **FxCallResult** | fx-call の実行結果を表す型。成功/失敗を値として表現。 |

---

## Appendix C: Version History

| Version | Date | Changes |
|---------|------|---------|
| **2.1.2** | 2026-02-04 | **cancel semantics 追加**: cancel phase, 伝播ルール, silent ignore。**FxCallResult 確定**: fx-call 専用, throw なし, unwrap 禁止。**Runner Specification 追加**: Child 実行の orchestration。**Output Binding Pattern 完成**: fx-call.done, fx-yield.done 統一。 |
| **2.1.1** | 2026-02-04 | LocalTimeline Implementation Specification 追加。Flow exit value = undefined 規則明文化。Effect 単一性制約追加。fx-return.done 明示的に禁止。 |
| **2.1** | 2026-02-04 | **Breaking:** `FxCollapseNode` 削除。FRP への接続を `done` 属性による Binding に一本化。 |
| **2.0** | 2026-02-03 | Design Freeze: Flow Model 確定、fx-context → fx-flow、SubTimeline Model、Remote Flow |
| **1.0** | 2026-02-03 | 初版リリース |

---

**END OF SPECIFICATION v2.1.2**