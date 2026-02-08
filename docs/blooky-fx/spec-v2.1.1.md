## 📄 blooky-fx Architecture Specification v2.1.1

**Version:** 2.1.1  
**Date:** 2026-02-04  
**Status:** 🔒 Design Freeze  
**Type:** Breaking Change / Architectural Refinement

---

## Change Summary

### Added
1. **LocalTimeline Implementation Specification**
   - Child Timeline lifecycle management
   - Cancel silent ignore behavior
   - stepHistory usage constraints

2. **Output Binding Pattern**
   - `fx-call.done` support
   - `fx-yield.done` support
   - Unified Binding mechanism

3. **Flow Exit Value Semantics**
   - Default to `undefined` without `fx-return`

4. **Effect Singularity Constraint**
   - One effect per exit phase maximum

### Removed
1. **FxCollapseNode** (Breaking)
   - Replaced by Output Binding Pattern

### Prohibited
1. **fx-return.done** (Explicit)
   - Return is a Flow boundary node, not a Binding node

---

## Table of Contents Updates

### New Sections
- 11.5 LocalTimeline Implementation
- 14.3 Output Binding Pattern
- 17.5 Binding Constraints

### Modified Sections
- 3.1 FxNode (removed FxCollapseNode)
- 3.2 ExecutionStep (added Effect Singularity)
- 5.3 Value Passing (added default undefined rule)

---

## Full Specification Text

### 3.1 FxNode (Updated)

```markdown
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

**Rationale:**

Node が FRP Stream に直接値を注入することは禁止される。
すべての FRP への反映は `effect` を通じて Timeline が行う。

### 3.2 ExecutionStep

FxNode の実行進行を表す**不変の事実**。
ExecutionStep は Timeline によって解釈・再構成されてはならない。

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
```

---

**Effect Singularity Constraint (v2.1):**

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

1. **単一責任の原則**
   - 各 Node は1つの値を生成する
   - 複数の出力は親ノード（sequence など）で分割

2. **Timeline の apply ロジックがシンプル**
   - `if (effect) await tick(effect)` だけで済む

3. **collapse 的ノードの再発を防止**
   - 複数 effect = 複数の副作用 = collapse と同じ

---
```

---

### 5.3 Value Passing (Updated)

```markdown
### 5.3 Value Passing

**Rule:**

fx-yield は Child Timeline の exit value を自身の評価結果として Parent Timeline に返す。

**If a Flow exits without fx-return, its exit value is `undefined`.** (v2.1)

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

3. **Optional な戻り値**
   ```typescript
   const result = await fx.yield({ for: flow })
   if (result !== undefined) {
     // 値が返された
   }
   ```

---

**Analogy: JavaScript Function**

```javascript
// Function without return
function process() {
  doSomething()
  // implicit: return undefined
}

// blooky-fx
fx.flow({},
  fx.call(ref('doSomething'))
  // implicit: exit value = undefined
)
```

---
```

---

### 11.5 LocalTimeline Implementation (New)

```markdown
### 11.5 LocalTimeline Implementation

**Overview:**

LocalTimeline は ExecutionStep を順序通りに処理し、Child Timeline のライフサイクルを管理する。

**Responsibilities:**

1. ExecutionStep を順序通りに処理（Fact Recorder）
2. DripEffect を apply（exit phase のみ）
3. Child Timeline のライフサイクル管理
4. cancel を Child に伝播

**Non-Responsibilities:**

- 実行フローの制御（throw しない）
- Step の改変
- Node の実行ロジックへの介入

---

#### 11.5.1 Child Timeline Lifecycle

**Data Structure:**

```typescript
type ChildRecord = {
  executionId: string
  timeline: Timeline
  suspendedBy: ExecutionStepId  // どの suspend step が作ったか
}

class LocalTimeline {
  private activeChildren = new Map<string, ChildRecord>()
}
```

---

**Registration (suspend step):**

Child Timeline は `suspend` step が emit されたときに登録される。

```typescript
private registerChild(step: ExecutionStep): void {
  if (step.phase !== "suspend") return
  if (step.data?.condition?.type !== "yield") return

  const { childExecutionId } = step.data.condition

  // 重複チェック（実装バグ検出）
  if (this.activeChildren.has(childExecutionId)) {
    throw new Error(
      `Invariant Violation: Child already registered: ${childExecutionId}`
    )
  }

  // Child Timeline 生成
  const childTimeline = this.createChildTimeline(childExecutionId)

  // 親子関係を記録
  this.activeChildren.set(childExecutionId, {
    executionId: childExecutionId,
    timeline: childTimeline,
    suspendedBy: step.id
  })
}
```

**NOTE:**

`suspend` step は「これ以降の進行は child に委ねられる」という事実を Timeline に記録するためのものである。

child の prepare/execute はこの事実に基づいて直後に開始される。

---

**Unregistration (resume step):**

Child Timeline は `resume` step が emit されたときに削除される。

```typescript
private unregisterChild(step: ExecutionStep): void {
  if (step.phase !== "resume") return

  // 対応する suspend step を探す
  const previousStepId = this.getPreviousSuspendStepId(step)
  
  const matching = [...this.activeChildren.entries()]
    .find(([_, record]) => record.suspendedBy === previousStepId)

  if (!matching) {
    throw new Error(
      `Invariant Violation: Resume without matching suspend: ${step.id}`
    )
  }

  const [childExecutionId] = matching
  this.activeChildren.delete(childExecutionId)
}
```

---

#### 11.5.2 stepHistory Constraint

**Purpose:**

`stepHistory` は suspend/resume の整合性検証のためにのみ保持される。

```typescript
/**
 * NOTE:
 * stepHistory は suspend/resume の整合性検証のためにのみ保持される。
 * Timeline がこの履歴を元に実行順序を決定したり、制御判断を行ったりしてはならない。
 * ExecutionStep は「過去の事実」であり、制御のための「状態」ではない。
 */
private stepHistory: ExecutionStep[] = []
```

**Prohibited Usage:**

- ❌ stepHistory を元に実行順序を変更
- ❌ stepHistory を元に pause/resume を実装
- ❌ stepHistory を元に分岐判断
- ❌ stepHistory を元に巻き戻し

**Permitted Usage:**

- ✅ suspend → resume の対応付け検証
- ✅ DevTools での履歴表示
- ✅ デバッグ情報の出力

---

#### 11.5.3 Cancel Silent Ignore

**Behavior:**

cancel された Timeline は、その後の step を**静かに無視**する。

```typescript
async emit(step: ExecutionStep): Promise<void> {
  // cancel 後の step は静かに無視
  if (this.cancelled) {
    stepTick(step, this.executionId, { ignored: true })
    return  // throw しない
  }

  // 通常処理
  // ...
}
```

**Rationale:**

1. **非同期競合への寛容さ**
   - cancel は非同期に発生する
   - 直後に step が届くのは正当な競合状態
   - Timeline は「拒否」ではなく「無視」する

2. **呼び出し元への制御責任の押し付けを防ぐ**
   - throw すると呼び出し元が try-catch を強制される
   - cancel は例外ではない（Document の破棄）

3. **SPEC 12章との整合**
   - Cancel は Document の破棄
   - 破棄された Document への書き込みは無視される
   - iframe removal と同じ意味論

---

#### 11.5.4 Child Timeline Abstraction

**createChildTimeline の責務:**

```typescript
/**
 * NOTE:
 * 現在は LocalTimeline を返すが、将来的にはここが RemoteTimeline との分岐点になる。
 * 親 Timeline は、返されたものが Local か Remote かを意識しない。
 */
private createChildTimeline(childExecutionId: string): Timeline {
  return new LocalTimeline(childExecutionId)
}
```

**Abstraction Principle:**

- 親 Timeline は「Child Timeline」という事実しか知らない
- Local / Remote は transport の問題
- Timeline interface だけで通信

**Future Extension:**

```typescript
// 将来の実装（例）
private createChildTimeline(childExecutionId: string): Timeline {
  // URL で Remote か判定
  if (isRemoteExecutionId(childExecutionId)) {
    return new RemoteTimeline(childExecutionId, adapter)
  }
  return new LocalTimeline(childExecutionId)
}
```
---


### 14.3 Output Binding Pattern (New)

### 14.3 Output Binding Pattern

**Principle:**

FxNode から FRP への値の反映は、`done` 属性による Binding を通じてのみ行われる。

Node は値を `return` するだけであり、Timeline が `effect` として apply する。

---

#### 14.3.1 Supported Nodes

| Node | Output | Binding | Purpose |
|------|--------|---------|---------|
| `fx-call` | 関数の戻り値 | `done?: FxRef<DripperStream<T>>` | 関数実行 + Stream 接続 |
| `fx-yield` | Child の exit value | `done?: FxRef<DripperStream<T>>` | Document 生成 + Stream 接続 |
| `fx-return` | 明示的な値 | （親が受け取る） | Flow の戻り値設定 |

---

#### 14.3.2 Implementation Pattern

```typescript
// Node の execute() 内
async *execute(ctx: ExecutionContext) {
  yield { phase: "enter", node: ctx.node }
  
  // 1. 値を生成（ノード固有の処理）
  const result = /* ノード固有の処理 */
  
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

#### 14.3.3 fx-call Example

```typescript
const resultStream$ = stream<number>()

fx.call(ref('compute'), {
  args: { x: ref('10') },
  done: ref('resultStream$'),  // ← 戻り値を Stream に流す
  id: 'computed'
})

// Timeline が exit phase で tick(effect) を呼ぶ
// → resultStream$ に値が流れる
```

---

#### 14.3.4 fx-yield Example

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

#### 14.3.5 Combined Example

```typescript
const statusStream$ = stream<string>()

fx.sequence([
  // Call で API リクエスト
  fx.call(ref('fetchData'), {
    args: { url: ref('apiUrl') },
    done: ref('statusStream$'),  // ← "fetched" を流す
    id: 'data'
  }),
  
  // Yield で処理
  fx.yield({
    for: ref('processFlow'),
    value: ref('#data'),
    done: ref('statusStream$'),  // ← "processed" を流す
    id: 'result'
  }),
  
  // Return で完了
  fx.return(ref('#result'))
])

// statusStream$ には "fetched" → "processed" の順で値が流れる
```

---

#### 14.3.6 Rationale

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

```typescript
// ❌ Prohibited
class BadNode {
  async *execute(ctx) {
    stream$.drip(value)  // ❌ 直接操作
  }
}

// ✅ Correct
class GoodNode {
  async *execute(ctx) {
    yield {
      phase: "exit",
      node: ctx.node,
      effect: drip(value)(stream$)  // ✅ effect として返す
    }
  }
}
```

---
```

---

### 17.5 Binding Constraints (New)

```markdown
### 17.5 Binding Constraints

#### 17.5.1 fx-return に done は禁止

**Rule:**

`fx-return` に `done` 属性を追加してはならない。

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

---

**Rationale:**

**1. fx-return は Flow 境界ノード**

```
fx-call / fx-yield   → FRP との接続点（Binding Node）
fx-return            → Flow の exit value 定義（Boundary Node）
```

fx-return は Binding ノードではない。

**2. done を付けると collapse が復活する**

```typescript
fx.return(value, { done: stream$ })
```

これは意味論的に「Flow の終了と同時に副作用を起こす専用ノード」であり、`fx-collapse` の別名である。

**3. 正しい出口は fx-yield の done**

```typescript
// ✅ 正しい設計
fx.yield({
  for: ref('someFlow'),
  done: ref('completion$')  // ← Flow の exit value を接続
})
```

- Flow の exit value を
- Document / Timeline 境界で
- Binding として FRP に接続する

**分離が明確:**
- return は値を返すだけ
- 接続は yield でやる

---

#### 17.5.2 Node 内での Stream 直接操作の禁止

**Prohibited:**

```typescript
// ❌ Node 内で Stream に直接書き込み
class BadNode {
  async *execute(ctx) {
    const stream = ctx.appContext['myStream$']
    stream.drip(value)  // ❌ 禁止
    
    yield { phase: "exit", node: ctx.node }
  }
}
```

**Correct:**

```typescript
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

#### 17.5.3 複数 effect の禁止

**Prohibited:**

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
```

**Correct:**

```typescript
// ✅ 親ノードで分割
fx.sequence([
  fx.call(ref('fn1'), { done: ref('stream1$') }),
  fx.call(ref('fn2'), { done: ref('stream2$') })
])
```

---
```

---

### 18.2 Deprecated APIs (Updated)

```markdown
### 18.2 Deprecated APIs

#### FxCollapseNode

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

#### fx-context

**Status:** Deprecated in v2.0, will be removed in v3.0

**Replacement:** `fx.flow`

---
```

---

## Appendix C: Version History (Updated)

```markdown
## Appendix C: Version History

| Version | Date | Changes |
|---------|------|---------|
| **2.1.1** | 2026-02-04 | **Breaking:** `FxCollapseNode` 削除。Output Binding Pattern 追加（`fx-call.done`, `fx-yield.done`）。LocalTimeline Implementation Specification 追加。Flow exit value = undefined 規則明文化。Effect 単一性制約追加。fx-return.done 明示的に禁止。 |
| **2.1** | 2026-02-04 | FRP への接続を `fx-yield` 等の `done` 属性による Binding に一本化。 |
| **2.0** | 2026-02-03 | Design Freeze: Flow Model 確定、fx-context → fx-flow、SubTimeline Model、Remote Flow |
| **1.0** | 2026-02-03 | 初版リリース |
```

---

## Summary of Key Decisions

### ✅ Adopted

1. **LocalTimeline** - Child 管理、cancel silent ignore、stepHistory 制約
2. **Output Binding Pattern** - `done` 属性による統一的な FRP 接続
3. **Flow exit value = undefined** - fx-return がない場合のデフォルト
4. **Effect Singularity** - exit phase で最大1個の effect

### ❌ Removed

1. **FxCollapseNode** - Output Binding Pattern で代替

### 🚫 Prohibited

1. **fx-return.done** - Flow 境界ノードに Binding は不適切
2. **Node 内での Stream 直接操作** - effect を通じてのみ
3. **複数 effect** - 単一責任の原則

---

**END OF SPECIFICATION v2.1.1**
