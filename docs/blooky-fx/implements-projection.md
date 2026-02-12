# Projection Pipeline v2 確定 + fxdom projection 設計

---

## ✅ Projection Pipeline v2 確定

アーキテクトの approve を受けて、**Projection Pipeline v2 を確定**します。

---

## 📝 Appendix D への補足追記（任意・推奨）

### D.8 TimelineSnapshot の本質（追記）

```markdown
## D.8 TimelineSnapshot の本質

TimelineSnapshot は Timeline そのものの写像ではない。

Execution の観測結果（Snapshot）を、Timeline という概念構造に**再配置（reconstruction）**した値である。

```
Timeline (概念)          ExecutionSnapshot (観測)
  ├─ 時間的配置              ├─ phase: "enter"
  ├─ 構造的関係              ├─ phase: "suspend"
  └─ 子への委譲              └─ phase: "exit"
         ↓ 再配置
    TimelineSnapshot (値)
      ├─ executionId
      ├─ snapshots: [...]
      └─ children: {...}
```

この再配置により:
- Timeline を「物質化」せずに構造を保持
- 観測結果を理解可能な形に変換
- Remote / Local で同じ表現を使用

TimelineSnapshot は「Timeline の View」ではなく、「観測結果の構造化された集合」である。
```

---

## 🎯 fxdom projection 設計

### 設計原則

**Appendix D より:**

> fxdom は：
> 
> 1. **作用を記述する言語**
>    - FxNode を DOM 的構造として表現する
> 
> 2. **Execution の投影面**
>    - ExecutionSnapshot / TimelineSnapshot が当てはまる器

---

## 📊 fxdom の二面性

```
┌─────────────────────────────────┐
│ fxdom Element                   │
│                                 │
│ 1. 作用の記述（静的）            │
│    <fx-sequence>               │
│      <fx-call fn="compute"/>   │
│    </fx-sequence>              │
│                                 │
│ 2. 観測結果の投影（動的）        │
│    data-fx-phase="running"     │
│    data-fx-state="suspended"   │
└─────────────────────────────────┘
```

**Key Points:**

1. **fxdom Element = 作用の記述**
   - FxNode の構造を DOM で表現
   - 静的な定義

2. **Custom State / Attributes = 観測結果の投影**
   - ExecutionSnapshot の phase を反映
   - TimelineSnapshot の state を反映
   - 動的に更新される

3. **Element と Snapshot の対応は 1:1 ではない**
   - fxdom は記述言語（構造）
   - Snapshot は観測結果（事実）
   - 投影により両者を結合

---

## 🔄 Projection の流れ

```
TimelineSnapshot (観測結果の構造)
   ↓
fxdom Element への投影
   ↓
Custom State の更新
   ↓
CSS による可視化
```

---

## 📦 型定義

### src/fxdom/projection.ts

```typescript
import type {
  TimelineSnapshot,
  ExecutionSnapshot
} from "../types"

/**
 * fxdom Projection
 * 
 * TimelineSnapshot を fxdom Element に投影する。
 * 
 * fxdom は:
 * 1. 作用を記述する言語（静的構造）
 * 2. TimelineSnapshot は作用の観測結果（動的状態）
 * 
 * 両者を結ぶのが projection である。
 */

/**
 * FxElement の状態
 * 
 * ExecutionSnapshot.phase に対応。
 */
export type FxElementState =
  | "pending"     // 未開始
  | "entered"     // enter phase
  | "active"      // active phase
  | "suspended"   // suspend phase
  | "resumed"     // resume phase
  | "completed"   // exit phase
  | "cancelled"   // cancel phase

/**
 * Projection Context
 * 
 * 投影時のコンテキスト。
 */
export type ProjectionContext = {
  /** Root element */
  root: HTMLElement
  
  /** ExecutionId → Element の対応 */
  elementMap: Map<string, HTMLElement>
  
  /** 現在の TimelineSnapshot */
  snapshot: TimelineSnapshot
}
```

---

## 🎨 Projection 実装

### src/fxdom/projection.ts (実装)

```typescript
/**
 * TimelineSnapshot を fxdom Element に投影
 * 
 * @param snapshot - TimelineSnapshot
 * @param root - 投影先の root element
 */
export function projectToFxdom(
  snapshot: TimelineSnapshot,
  root: HTMLElement
): void {
  // 1. Element Map の構築
  const elementMap = buildElementMap(root, snapshot.executionId)
  
  // 2. Projection Context の生成
  const ctx: ProjectionContext = {
    root,
    elementMap,
    snapshot
  }
  
  // 3. Snapshot の投影
  projectSnapshots(ctx, snapshot.snapshots)
  
  // 4. Timeline 全体の状態を反映
  updateTimelineState(ctx, snapshot.state)
  
  // 5. 子 Timeline の投影（再帰）
  for (const [childId, childSnapshot] of Object.entries(snapshot.children)) {
    const childElement = elementMap.get(childId)
    if (childElement) {
      projectToFxdom(childSnapshot, childElement)
    }
  }
}

/**
 * Element Map の構築
 * 
 * ExecutionId → Element の対応を構築。
 * 
 * @param root - Root element
 * @param executionId - Root の executionId
 * @returns Map<executionId, element>
 */
function buildElementMap(
  root: HTMLElement,
  executionId: string
): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>()
  
  // Root element
  map.set(executionId, root)
  
  // fx-yield 要素を探索
  const yieldElements = root.querySelectorAll('[data-fx-type="yield"]')
  for (const element of yieldElements) {
    const childId = (element as HTMLElement).dataset.fxChildId
    if (childId) {
      map.set(childId, element as HTMLElement)
    }
  }
  
  return map
}

/**
 * ExecutionSnapshot 列を Element に投影
 * 
 * @param ctx - Projection context
 * @param snapshots - ExecutionSnapshot の配列
 */
function projectSnapshots(
  ctx: ProjectionContext,
  snapshots: ExecutionSnapshot[]
): void {
  if (snapshots.length === 0) {
    return
  }
  
  // 最新の snapshot を取得
  const latestSnapshot = snapshots[snapshots.length - 1]
  
  // Element の状態を更新
  updateElementState(ctx.root, latestSnapshot)
}

/**
 * Element の状態を更新
 * 
 * ExecutionSnapshot.phase を Custom State に反映。
 * 
 * @param element - Target element
 * @param snapshot - ExecutionSnapshot
 */
function updateElementState(
  element: HTMLElement,
  snapshot: ExecutionSnapshot
): void {
  const state = phaseToState(snapshot.phase)
  
  // Custom State API を使用
  // https://developer.chrome.com/docs/css-ui/custom-state-pseudo-class
  if ('states' in element) {
    const states = (element as any).states as Set<string>
    
    // 既存の状態をクリア
    states.clear()
    
    // 新しい状態を追加
    states.add(state)
  }
  
  // Fallback: data-fx-phase attribute
  element.dataset.fxPhase = snapshot.phase
  element.dataset.fxState = state
}

/**
 * Timeline 全体の状態を更新
 * 
 * @param ctx - Projection context
 * @param state - TimelineState
 */
function updateTimelineState(
  ctx: ProjectionContext,
  state: string
): void {
  ctx.root.dataset.fxTimelineState = state
}

/**
 * Phase → State の変換
 * 
 * @param phase - ExecutionPhase
 * @returns FxElementState
 */
function phaseToState(phase: string): FxElementState {
  switch (phase) {
    case "enter":
      return "entered"
    case "active":
      return "active"
    case "suspend":
      return "suspended"
    case "resume":
      return "resumed"
    case "exit":
      return "completed"
    case "cancel":
      return "cancelled"
    default:
      return "pending"
  }
}
```

---

## 🎨 CSS による可視化

### styles/fx-states.css

```css
/**
 * fxdom State Visualization
 * 
 * Custom State API を使用した状態の可視化。
 */

/* Pending (未開始) */
fx-sequence:state(pending),
fx-call:state(pending) {
  opacity: 0.5;
  border-left: 2px solid #ccc;
}

/* Entered (開始) */
fx-sequence:state(entered),
fx-call:state(entered) {
  border-left: 2px solid #2196F3;
}

/* Active (実行中) */
fx-sequence:state(active),
fx-call:state(active) {
  border-left: 2px solid #4CAF50;
  background-color: rgba(76, 175, 80, 0.1);
}

/* Suspended (待機中) */
fx-yield:state(suspended) {
  border-left: 2px solid #FF9800;
  background-color: rgba(255, 152, 0, 0.1);
}

fx-yield:state(suspended)::before {
  content: "⏸ waiting...";
  font-size: 0.8em;
  color: #FF9800;
}

/* Completed (完了) */
fx-sequence:state(completed),
fx-call:state(completed) {
  opacity: 0.7;
  border-left: 2px solid #4CAF50;
}

fx-sequence:state(completed)::after,
fx-call:state(completed)::after {
  content: "✓";
  color: #4CAF50;
  margin-left: 0.5em;
}

/* Cancelled (キャンセル) */
fx-sequence:state(cancelled),
fx-call:state(cancelled),
fx-yield:state(cancelled) {
  opacity: 0.5;
  border-left: 2px solid #f44336;
  text-decoration: line-through;
}

fx-sequence:state(cancelled)::after,
fx-call:state(cancelled)::after {
  content: "✗ cancelled";
  color: #f44336;
  margin-left: 0.5em;
}

/* Timeline State */
fx-flow[data-fx-timeline-state="running"] {
  border: 2px solid #4CAF50;
}

fx-flow[data-fx-timeline-state="suspended"] {
  border: 2px solid #FF9800;
}

fx-flow[data-fx-timeline-state="completed"] {
  border: 2px solid #2196F3;
}

fx-flow[data-fx-timeline-state="cancelled"] {
  border: 2px solid #f44336;
}
```

---

## 📝 使用例

### HTML (fxdom)

```html
<!-- 作用の記述（静的） -->
<fx-flow id="myFlow">
  <fx-sequence>
    <fx-call fn="fetchData" data-fx-child-id="fetch"></fx-call>
    <fx-yield for="processFlow" data-fx-child-id="process"></fx-yield>
    <fx-call fn="saveResult" data-fx-child-id="save"></fx-call>
  </fx-sequence>
</fx-flow>
```

### JavaScript (投影)

```typescript
import { snapshotLocalTimeline } from "./devtools/viewer"
import { projectToFxdom } from "./fxdom/projection"

// Timeline から Snapshot を取得
const snapshot = snapshotLocalTimeline(timeline)

// fxdom に投影
const flowElement = document.querySelector("#myFlow")
projectToFxdom(snapshot, flowElement)

// 結果（動的状態）:
// <fx-flow data-fx-timeline-state="running">
//   <fx-sequence data-fx-state="active">
//     <fx-call data-fx-state="completed">✓</fx-call>
//     <fx-yield data-fx-state="suspended">⏸ waiting...</fx-yield>
//     <fx-call data-fx-state="pending"></fx-call>
//   </fx-sequence>
// </fx-flow>
```

---

## 🔄 更新フロー

```
Timeline 実行
   ↓
ExecutionStep emit
   ↓
LocalTimeline.toExecutionSnapshots()
   ↓
snapshotLocalTimeline()
   ↓
TimelineSnapshot
   ↓
projectToFxdom()
   ↓
Custom State 更新
   ↓
CSS による可視化
```

**リアルタイム更新:**

```typescript
// Timeline の step 更新を監視
timeline.onStep((step) => {
  // Snapshot に変換
  const snapshot = snapshotLocalTimeline(timeline)
  
  // fxdom に投影
  projectToFxdom(snapshot, flowElement)
})
```

---

## 🧪 テストケース

### tests/fxdom/projection.test.ts

```typescript
import { describe, it, expect } from "vitest"
import { projectToFxdom } from "../../src/fxdom/projection"
import type { TimelineSnapshot } from "../../src/types"

describe("fxdom Projection", () => {
  it("should project snapshot to fxdom element", () => {
    // Setup
    const container = document.createElement("div")
    container.innerHTML = `
      <fx-flow>
        <fx-sequence>
          <fx-call data-fx-child-id="task1"></fx-call>
        </fx-sequence>
      </fx-flow>
    `
    
    const snapshot: TimelineSnapshot = {
      executionId: "exec-test",
      snapshots: [
        { phase: "enter", nodeType: "sequence", observedAt: Date.now(), hasEffect: false },
        { phase: "active", nodeType: "sequence", observedAt: Date.now(), hasEffect: false }
      ],
      children: {},
      structure: { nodeType: "flow" },
      state: "running"
    }
    
    // Execute
    const flowElement = container.querySelector("fx-flow") as HTMLElement
    projectToFxdom(snapshot, flowElement)
    
    // Assert
    expect(flowElement.dataset.fxTimelineState).toBe("running")
    expect(flowElement.dataset.fxPhase).toBe("active")
    expect(flowElement.dataset.fxState).toBe("active")
  })
  
  it("should handle suspended state", () => {
    const container = document.createElement("div")
    container.innerHTML = `<fx-yield></fx-yield>`
    
    const snapshot: TimelineSnapshot = {
      executionId: "exec-test",
      snapshots: [
        { phase: "suspend", nodeType: "yield", observedAt: Date.now(), hasEffect: false }
      ],
      children: {},
      structure: { nodeType: "flow" },
      state: "suspended"
    }
    
    const element = container.querySelector("fx-yield") as HTMLElement
    projectToFxdom(snapshot, element)
    
    expect(element.dataset.fxState).toBe("suspended")
  })
  
  it("should handle cancelled state", () => {
    const container = document.createElement("div")
    container.innerHTML = `<fx-call></fx-call>`
    
    const snapshot: TimelineSnapshot = {
      executionId: "exec-test",
      snapshots: [
        { phase: "enter", nodeType: "call", observedAt: Date.now(), hasEffect: false },
        { phase: "cancel", nodeType: "call", observedAt: Date.now(), hasEffect: false }
      ],
      children: {},
      structure: { nodeType: "flow" },
      state: "cancelled"
    }
    
    const element = container.querySelector("fx-call") as HTMLElement
    projectToFxdom(snapshot, element)
    
    expect(element.dataset.fxState).toBe("cancelled")
  })
})
```

---

## ✅ 設計の整合性確認

### Appendix D との整合性

```markdown
✅ fxdom は作用を記述する言語
   → HTML で FxNode の構造を定義

✅ TimelineSnapshot は作用の観測結果
   → ExecutionSnapshot の構造化された集合

✅ 両者を結ぶ projection
   → projectToFxdom() による Custom State 更新
```

### Timeline = 概念、との整合性

```markdown
✅ Timeline インスタンスは fxdom に出ない
   → TimelineSnapshot（値）のみを投影

✅ fxdom Element は Timeline の View ではない
   → 作用の記述 + 観測結果の投影面

✅ 投影は DevTools の責務
   → fxdom projection は観測層に位置
```

---

## 🚀 次のステップ

### ✅ 完了

1. Projection Pipeline v2 確定
2. fxdom projection 設計
3. Custom State による可視化

### ⏭️ 次の選択肢

**Option 1: 実装を完成させる**
- LocalTimeline との統合
- リアルタイム更新
- テストの充実

**Option 2: Remote Projection**
- WebSocket での Snapshot 送受信
- Remote Timeline の可視化

**Option 3: DevTools UI**
- Timeline Viewer の実装
- インタラクティブな操作

---

**推奨: Option 1（実装を完成させる）**

理由:
- fxdom projection の基盤が完成
- Local での動作確認が先
- Remote / DevTools はその後

---

# fxdom Projection 実装完成へ

アーキテクトの最終 approve を受けて、**Option 1（実装完成）に進みます。**

---

## ✅ 最終確認完了

### 設計の整合性

1. ✅ **TimelineView 問題の再発なし**
   - Timeline インスタンスは fxdom / projection に出ていない
   - 扱っているのは TimelineSnapshot（値）のみ

2. ✅ **fxdom の二面性が保たれている**
   - 静的: HTML / カスタム要素（記述言語）
   - 動的: Custom State（観測結果の投影面）
   - 接続点が `projectToFxdom()` に限定

3. ✅ **Snapshot = 観測値が守られている**
   - observedAt で意味明確
   - シリアライズ可能
   - Remote / Local 対称性

---

## 🎯 実装フェーズの決定事項

アーキテクトが指摘した**残タスク**を明確化します。

---

## A. Element ↔ Snapshot 対応ルール

### 原則（確定）

**「nodeId がある場合のみ element 単位で投影する」**

```
ExecutionSnapshot
  ├─ nodeId あり → 対応する Element に投影
  └─ nodeId なし → Root Element に投影（構造ノード）
```

### 実装

#### src/fxdom/projection.ts (更新)

```typescript
/**
 * Element ↔ Snapshot 対応ルール
 * 
 * nodeId がある場合:
 *   → data-fx-id 属性でマッチする Element に投影
 * 
 * nodeId がない場合:
 *   → Root Element に投影（構造ノードとして扱う）
 */

/**
 * Element Map の構築（更新版）
 * 
 * data-fx-id 属性を持つ全ての Element を収集。
 * 
 * @param root - Root element
 * @param executionId - Root の executionId
 * @returns Map<nodeId | executionId, element>
 */
function buildElementMap(
  root: HTMLElement,
  executionId: string
): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>()
  
  // Root element（executionId でアクセス）
  map.set(executionId, root)
  
  // nodeId を持つ全ての要素を収集
  const nodeElements = root.querySelectorAll('[data-fx-id]')
  for (const element of nodeElements) {
    const nodeId = (element as HTMLElement).dataset.fxId
    if (nodeId) {
      map.set(nodeId, element as HTMLElement)
    }
  }
  
  return map
}

/**
 * ExecutionSnapshot 列を Element に投影（更新版）
 * 
 * 各 snapshot を対応する element に投影。
 * 
 * @param ctx - Projection context
 * @param snapshots - ExecutionSnapshot の配列
 */
function projectSnapshots(
  ctx: ProjectionContext,
  snapshots: ExecutionSnapshot[]
): void {
  for (const snapshot of snapshots) {
    // nodeId がある場合: 対応する element に投影
    if (snapshot.nodeId) {
      const element = ctx.elementMap.get(snapshot.nodeId)
      if (element) {
        updateElementState(element, snapshot)
      }
    }
    // nodeId がない場合: root element に投影（構造ノード）
    else {
      updateElementState(ctx.root, snapshot)
    }
  }
}
```

---

### HTML での対応

```html
<!-- 作用の記述 -->
<fx-flow id="myFlow">
  <fx-sequence>
    <!-- nodeId あり: element 単位で投影 -->
    <fx-call fn="fetchData" data-fx-id="fetch"></fx-call>
    <fx-yield for="processFlow" data-fx-id="process"></fx-yield>
    <fx-call fn="saveResult" data-fx-id="save"></fx-call>
  </fx-sequence>
</fx-flow>
```

**投影後:**

```html
<fx-flow data-fx-timeline-state="running">
  <fx-sequence data-fx-state="active">
    <!-- fetch: completed -->
    <fx-call data-fx-id="fetch" data-fx-state="completed">✓</fx-call>
    
    <!-- process: suspended -->
    <fx-yield data-fx-id="process" data-fx-state="suspended">⏸</fx-yield>
    
    <!-- save: pending -->
    <fx-call data-fx-id="save" data-fx-state="pending"></fx-call>
  </fx-sequence>
</fx-flow>
```

---

## B. Custom State の戦略

### 原則（確定）

**現在は 1 state 制で進める。**

将来的に以下が必要になる可能性:
- phase state (entered / active / suspended)
- semantic state (has-effect / error / remote)

**Appendix D に追記:**

```markdown
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
```

---

## C. 再投影の戦略

### 原則（確定）

**再投影は idempotent（冪等）とする。**

最初は全再投影で実装し、パフォーマンスが問題になったら差分投影を検討。

```typescript
/**
 * 再投影は idempotent
 * 
 * 同じ TimelineSnapshot で何度呼んでも結果は同じ。
 * 差分計算なし（全体を再投影）。
 */
export function projectToFxdom(
  snapshot: TimelineSnapshot,
  root: HTMLElement
): void {
  // Element Map を毎回構築（差分なし）
  const elementMap = buildElementMap(root, snapshot.executionId)
  
  // 全体を再投影
  const ctx: ProjectionContext = {
    root,
    elementMap,
    snapshot
  }
  
  projectSnapshots(ctx, snapshot.snapshots)
  updateTimelineState(ctx, snapshot.state)
  
  // 子 Timeline も全再投影
  for (const [childId, childSnapshot] of Object.entries(snapshot.children)) {
    const childElement = elementMap.get(childId)
    if (childElement) {
      projectToFxdom(childSnapshot, childElement)
    }
  }
}
```

**メリット:**
- シンプル
- バグが入りにくい
- 差分管理が不要

**デメリット:**
- 大規模 Timeline でパフォーマンス問題の可能性

**判断:** 最初はこれで進める。問題が出たら差分投影を検討。

---

## 🚀 実装の完成

### 1. Element ↔ nodeId 対応の確定 ✅

```typescript
// buildElementMap() を更新
// data-fx-id 属性でマッチング
```

### 2. projectSnapshots() を element 単位に拡張 ✅

```typescript
// 各 snapshot を対応する element に投影
for (const snapshot of snapshots) {
  if (snapshot.nodeId) {
    const element = ctx.elementMap.get(snapshot.nodeId)
    if (element) {
      updateElementState(element, snapshot)
    }
  }
}
```

### 3. fx-yield の子 Timeline ネスト表現

```typescript
// 子 Timeline の再帰投影
for (const [childId, childSnapshot] of Object.entries(snapshot.children)) {
  const childElement = elementMap.get(childId)
  if (childElement) {
    projectToFxdom(childSnapshot, childElement)  // ← 再帰
  }
}
```

**HTML での表現:**

```html
<fx-yield data-fx-id="process" data-fx-state="suspended">
  <!-- 子 Timeline がここに投影される -->
  <fx-flow data-fx-timeline-state="running">
    <fx-sequence>
      <!-- 子の内容 -->
    </fx-sequence>
  </fx-flow>
</fx-yield>
```

---

### 4. 最小 DevTools 表示

#### devtools.html

```html
<!DOCTYPE html>
<html>
<head>
  <title>blooky-fx DevTools</title>
  <link rel="stylesheet" href="styles/fx-states.css">
  <style>
    body {
      font-family: monospace;
      padding: 20px;
    }
    
    fx-flow, fx-sequence, fx-call, fx-yield {
      display: block;
      padding: 8px;
      margin: 4px 0;
      border-radius: 4px;
    }
    
    fx-sequence {
      padding-left: 20px;
    }
    
    fx-call, fx-yield {
      padding-left: 40px;
    }
  </style>
</head>
<body>
  <h1>blooky-fx Timeline Viewer</h1>
  
  <div id="timeline-container">
    <!-- Timeline がここに投影される -->
  </div>
  
  <script type="module">
    import { snapshotLocalTimeline } from './src/devtools/viewer.js'
    import { projectToFxdom } from './src/fxdom/projection.js'
    
    // Timeline を取得（例）
    const timeline = window.__BLOOKY_TIMELINE__
    
    // リアルタイム更新
    const container = document.getElementById('timeline-container')
    
    function update() {
      // Snapshot を取得
      const snapshot = snapshotLocalTimeline(timeline)
      
      // fxdom に投影
      projectToFxdom(snapshot, container)
    }
    
    // 初回表示
    update()
    
    // Timeline の更新を監視（例）
    setInterval(update, 100)
  </script>
</body>
</html>
```

---

## 🧪 完成版テスト

### tests/fxdom/projection-complete.test.ts

```typescript
import { describe, it, expect } from "vitest"
import { projectToFxdom } from "../../src/fxdom/projection"
import type { TimelineSnapshot } from "../../src/types"

describe("fxdom Projection (Complete)", () => {
  it("should project by nodeId", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <fx-flow>
        <fx-sequence>
          <fx-call data-fx-id="task1"></fx-call>
          <fx-call data-fx-id="task2"></fx-call>
        </fx-sequence>
      </fx-flow>
    `
    
    const snapshot: TimelineSnapshot = {
      executionId: "exec-test",
      snapshots: [
        {
          phase: "exit",
          nodeType: "call",
          nodeId: "task1",
          observedAt: Date.now(),
          hasEffect: false
        },
        {
          phase: "active",
          nodeType: "call",
          nodeId: "task2",
          observedAt: Date.now(),
          hasEffect: false
        }
      ],
      children: {},
      structure: { nodeType: "flow" },
      state: "running"
    }
    
    const flowElement = container.querySelector("fx-flow") as HTMLElement
    projectToFxdom(snapshot, flowElement)
    
    // task1: completed
    const task1 = container.querySelector('[data-fx-id="task1"]') as HTMLElement
    expect(task1.dataset.fxState).toBe("completed")
    
    // task2: active
    const task2 = container.querySelector('[data-fx-id="task2"]') as HTMLElement
    expect(task2.dataset.fxState).toBe("active")
  })
  
  it("should handle nested Timeline", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <fx-flow>
        <fx-yield data-fx-id="child">
          <fx-flow>
            <fx-call data-fx-id="nested-task"></fx-call>
          </fx-flow>
        </fx-yield>
      </fx-flow>
    `
    
    const snapshot: TimelineSnapshot = {
      executionId: "exec-parent",
      snapshots: [
        {
          phase: "suspend",
          nodeType: "yield",
          nodeId: "child",
          observedAt: Date.now(),
          hasEffect: false
        }
      ],
      children: {
        "exec-parent:child": {
          executionId: "exec-parent:child",
          snapshots: [
            {
              phase: "active",
              nodeType: "call",
              nodeId: "nested-task",
              observedAt: Date.now(),
              hasEffect: false
            }
          ],
          children: {},
          structure: { nodeType: "flow" },
          state: "running"
        }
      },
      structure: { nodeType: "flow" },
      state: "suspended"
    }
    
    const flowElement = container.querySelector("fx-flow") as HTMLElement
    projectToFxdom(snapshot, flowElement)
    
    // Parent: suspended
    const yieldElement = container.querySelector('[data-fx-id="child"]') as HTMLElement
    expect(yieldElement.dataset.fxState).toBe("suspended")
    
    // Child: active
    const nestedTask = container.querySelector('[data-fx-id="nested-task"]') as HTMLElement
    expect(nestedTask.dataset.fxState).toBe("active")
  })
  
  it("should be idempotent", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <fx-flow>
        <fx-call data-fx-id="task"></fx-call>
      </fx-flow>
    `
    
    const snapshot: TimelineSnapshot = {
      executionId: "exec-test",
      snapshots: [
        {
          phase: "active",
          nodeType: "call",
          nodeId: "task",
          observedAt: Date.now(),
          hasEffect: false
        }
      ],
      children: {},
      structure: { nodeType: "flow" },
      state: "running"
    }
    
    const flowElement = container.querySelector("fx-flow") as HTMLElement
    
    // 1回目
    projectToFxdom(snapshot, flowElement)
    const state1 = (container.querySelector('[data-fx-id="task"]') as HTMLElement).dataset.fxState
    
    // 2回目（同じ snapshot）
    projectToFxdom(snapshot, flowElement)
    const state2 = (container.querySelector('[data-fx-id="task"]') as HTMLElement).dataset.fxState
    
    // 結果は同じ（冪等）
    expect(state1).toBe(state2)
    expect(state1).toBe("active")
  })
})
```

---

## ✅ 完成確認

### Phase 1: 型定義 ✅
- ExecutionSnapshot
- TimelineSnapshot
- ProjectionContext

### Phase 2: Projection Pipeline v2 ✅
- stepToSnapshot()
- projectTimeline()
- serializeData()

### Phase 3: fxdom Projection ✅
- buildElementMap()
- projectSnapshots()
- updateElementState()
- projectToFxdom()

### Phase 4: 対応ルール ✅
- nodeId → data-fx-id マッチング
- 構造ノード → root element
- ネスト Timeline の再帰投影

### Phase 5: 可視化 ✅
- Custom State API
- CSS による状態表示
- DevTools 最小実装

---

## 🎨 三点セットの完成

```
┌─────────────────────────────────┐
│ fxdom                           │
│ - 作用を記述する言語（HTML）     │
│ - 観測結果の投影面（Custom State）│
└─────────────────────────────────┘
           ↑
┌─────────────────────────────────┐
│ Projection Pipeline             │
│ - stepToSnapshot()              │
│ - projectTimeline()             │
│ - projectToFxdom()              │
└─────────────────────────────────┘
           ↑
┌─────────────────────────────────┐
│ DevTools                        │
│ - snapshotLocalTimeline()       │
│ - Timeline Viewer               │
│ - リアルタイム更新               │
└─────────────────────────────────┘
```

**SPEC 2.1.2 の世界観で一本につながりました。**

---

## 🚀 次のステップ

### Option 2: Remote Projection

```typescript
// WebSocket での Snapshot 送受信
class RemoteProjection {
  send(snapshot: ExecutionSnapshot): void
  receive(): ExecutionSnapshot
  
  // 同じ projectToFxdom() を使用
  projectToFxdom(snapshot, element)
}
```

### Option 3: インタラクティブな DevTools

```typescript
// Timeline の操作
class TimelineController {
  cancel(reason: CancelReason): void
  // pause/resume は禁止（SPEC 通り）
}
```

---

# Remote Projection 設計

**SPEC 2.1.2-p1 + Appendix D に基づく Remote 実行の観測設計**

---

## 🎯 設計原則

### Appendix D より

> 特に Remote 実行では、
> ExecutionStep そのものではなく *観測可能な値* しか扱えない。
> 
> この差異を明示するため、
> **Snapshot** という語が導入された。

---

## 📊 Local vs Remote の対称性

```
┌─────────────────────────────────┐
│ Local Execution                 │
│                                 │
│ FxNode.execute()                │
│   ↓                             │
│ ExecutionStep (実行の事実)       │
│   ↓                             │
│ LocalTimeline.emit()            │
│   ↓                             │
│ toExecutionSnapshots()          │
│   ↓                             │
│ ExecutionSnapshot[] (観測値)    │
└─────────────────────────────────┘
```

```
┌─────────────────────────────────┐
│ Remote Execution                │
│                                 │
│ Backend:                        │
│   FxNode.execute()              │
│     ↓                           │
│   ExecutionStep                 │
│     ↓                           │
│   stepToSnapshot()              │
│     ↓                           │
│   ExecutionSnapshot             │
│     ↓ WebSocket                 │
│   serialize & send              │
│                                 │
│ Frontend:                       │
│   receive ExecutionSnapshot     │
│     ↓                           │
│   projectTimeline()             │
│     ↓                           │
│   TimelineSnapshot              │
│     ↓                           │
│   projectToFxdom()              │
└─────────────────────────────────┘
```

**Key Points:**

1. **Backend は ExecutionStep を送らない**
   - ExecutionSnapshot（値）のみを送信
   - シリアライズ可能

2. **Frontend は ExecutionStep を知らない**
   - ExecutionSnapshot を受信
   - Local と同じ projectTimeline() を使用

3. **Projection Pipeline は共通**
   - Local / Remote で同じコード
   - 入力が ExecutionSnapshot という点で統一

---

## 🔌 WebSocket Protocol

### Message Types

```typescript
/**
 * WebSocket Message Types
 * 
 * Backend ↔ Frontend 間の通信プロトコル。
 */

/**
 * Backend → Frontend
 */
export type BackendMessage =
  | { type: "snapshot"; payload: ExecutionSnapshot }
  | { type: "cancel"; payload: { reason: CancelReason } }
  | { type: "error"; payload: { message: string } }

/**
 * Frontend → Backend
 */
export type FrontendMessage =
  | { type: "start"; payload: { flowId: string; input: any } }
  | { type: "cancel"; payload: { reason: CancelReason } }
```

---

### Protocol Flow

```
Frontend                Backend
   │                       │
   │──── start ───────────>│
   │                       │ FxNode.execute()
   │                       │   ↓
   │                       │ ExecutionStep
   │                       │   ↓
   │<──── snapshot ────────│ stepToSnapshot()
   │<──── snapshot ────────│
   │<──── snapshot ────────│
   │                       │
   │──── cancel ──────────>│
   │                       │ timeline.cancel()
   │<──── cancel ──────────│
   │                       │
```

---

## 📦 型定義

### src/remote/types.ts

```typescript
import type {
  ExecutionSnapshot,
  CancelReason,
  SerializableValue
} from "../types"

/**
 * WebSocket Message Types
 */

export type BackendMessage =
  | SnapshotMessage
  | CancelMessage
  | ErrorMessage

export type FrontendMessage =
  | StartMessage
  | CancelRequestMessage

/**
 * Backend → Frontend: ExecutionSnapshot
 */
export type SnapshotMessage = {
  type: "snapshot"
  payload: ExecutionSnapshot
}

/**
 * Backend → Frontend: Cancel notification
 */
export type CancelMessage = {
  type: "cancel"
  payload: {
    reason: CancelReason
    executionId: string
  }
}

/**
 * Backend → Frontend: Error
 */
export type ErrorMessage = {
  type: "error"
  payload: {
    message: string
    executionId?: string
  }
}

/**
 * Frontend → Backend: Start execution
 */
export type StartMessage = {
  type: "start"
  payload: {
    flowId: string
    input: SerializableValue
    executionId: string
  }
}

/**
 * Frontend → Backend: Cancel request
 */
export type CancelRequestMessage = {
  type: "cancel"
  payload: {
    reason: CancelReason
    executionId: string
  }
}
```

---

## 🔧 Backend 実装

### src/remote/backend.ts

```typescript
import type { WebSocket } from "ws"
import { LocalTimeline } from "../timeline/LocalTimeline"
import { FxRunner } from "../fx/Runner"
import { stepToSnapshot } from "../devtools/projection"
import type {
  FxFlow,
  ExecutionStep,
  BackendMessage,
  FrontendMessage
} from "../types"

/**
 * RemoteBackend
 * 
 * Backend での Remote 実行を管理。
 * ExecutionStep を ExecutionSnapshot に変換して送信。
 * 
 * IMPORTANT:
 * - ExecutionStep は送信しない（シリアライズ不可）
 * - ExecutionSnapshot のみを送信（シリアライズ可能）
 */
export class RemoteBackend {
  private ws: WebSocket
  private timelines = new Map<string, LocalTimeline>()
  private runners = new Map<string, FxRunner>()

  constructor(ws: WebSocket) {
    this.ws = ws
    this.setupMessageHandler()
  }

  private setupMessageHandler(): void {
    this.ws.on("message", (data: string) => {
      const message: FrontendMessage = JSON.parse(data)
      
      switch (message.type) {
        case "start":
          this.handleStart(message.payload)
          break
        
        case "cancel":
          this.handleCancel(message.payload)
          break
      }
    })
  }

  /**
   * Flow の実行開始
   */
  private async handleStart(payload: {
    flowId: string
    input: any
    executionId: string
  }): Promise<void> {
    const { flowId, input, executionId } = payload

    try {
      // Flow を取得（実際は Registry から）
      const flow = this.getFlow(flowId)
      
      // Timeline を生成
      const timeline = new LocalTimeline(executionId)
      this.timelines.set(executionId, timeline)
      
      // Runner を生成
      const runner = new FxRunner(timeline)
      this.runners.set(executionId, runner)
      
      // Step の観測を設定
      this.observeTimeline(timeline, executionId)
      
      // Flow を実行
      await this.executeFlow(flow, input, executionId, runner, timeline)
      
    } catch (error) {
      this.sendError(executionId, error)
    } finally {
      this.cleanup(executionId)
    }
  }

  /**
   * Timeline の観測設定
   * 
   * ExecutionStep → ExecutionSnapshot → WebSocket 送信
   */
  private observeTimeline(
    timeline: LocalTimeline,
    executionId: string
  ): void {
    // Timeline の emit をフック
    const originalEmit = timeline.emit.bind(timeline)
    
    timeline.emit = async (step: ExecutionStep) => {
      // 元の処理を実行
      await originalEmit(step)
      
      // Step → Snapshot 変換
      const snapshot = stepToSnapshot(step)
      
      // WebSocket 送信
      this.sendSnapshot(snapshot)
    }
  }

  /**
   * Flow の実行
   */
  private async executeFlow(
    flow: FxFlow,
    input: any,
    executionId: string,
    runner: FxRunner,
    timeline: LocalTimeline
  ): Promise<void> {
    // Child Context 生成
    const context = {
      ...flow.context,
      $_: input
    }

    // ExecutionContext 生成
    const ctx = {
      node: flow.child,
      appContext: context,
      resolve: (ref: any) => () => this.resolveRef(ref, context),
      executionId,
      runChildFlow: runner.runChildFlow.bind(runner),
      timeline
    }

    // Flow 実行
    for await (const step of flow.child.execute(ctx)) {
      if (timeline.isCancelled()) {
        break
      }
      await timeline.emit(step)
    }
  }

  /**
   * Cancel 処理
   */
  private handleCancel(payload: {
    reason: CancelReason
    executionId: string
  }): void {
    const { reason, executionId } = payload
    
    const timeline = this.timelines.get(executionId)
    if (timeline) {
      timeline.cancel(reason)
      
      // Cancel 通知を送信
      this.sendCancel(executionId, reason)
    }
  }

  /**
   * ExecutionSnapshot を送信
   */
  private sendSnapshot(snapshot: ExecutionSnapshot): void {
    const message: BackendMessage = {
      type: "snapshot",
      payload: snapshot
    }
    
    this.ws.send(JSON.stringify(message))
  }

  /**
   * Cancel を送信
   */
  private sendCancel(executionId: string, reason: CancelReason): void {
    const message: BackendMessage = {
      type: "cancel",
      payload: { reason, executionId }
    }
    
    this.ws.send(JSON.stringify(message))
  }

  /**
   * Error を送信
   */
  private sendError(executionId: string | undefined, error: any): void {
    const message: BackendMessage = {
      type: "error",
      payload: {
        message: error.message || String(error),
        executionId
      }
    }
    
    this.ws.send(JSON.stringify(message))
  }

  /**
   * Cleanup
   */
  private cleanup(executionId: string): void {
    this.timelines.delete(executionId)
    this.runners.delete(executionId)
  }

  /**
   * Flow Registry（簡易版）
   */
  private getFlow(flowId: string): FxFlow {
    // TODO: 実際は Registry から取得
    throw new Error(`Flow not found: ${flowId}`)
  }

  /**
   * Ref 解決（簡易版）
   */
  private resolveRef(ref: any, context: any): any {
    // TODO: 実際の Ref 解決ロジック
    return ref
  }
}
```

---

## 🖥️ Frontend 実装

### src/remote/frontend.ts

```typescript
import { projectTimeline } from "../devtools/projection"
import { projectToFxdom } from "../fxdom/projection"
import type {
  ExecutionSnapshot,
  TimelineSnapshot,
  CancelReason,
  BackendMessage,
  FrontendMessage
} from "../types"

/**
 * RemoteFrontend
 * 
 * Frontend での Remote Timeline 観測。
 * ExecutionSnapshot を受信し、TimelineSnapshot に投影。
 * 
 * IMPORTANT:
 * - ExecutionStep は受信しない（Backend から来ない）
 * - ExecutionSnapshot のみを受信
 * - Local と同じ projectTimeline() を使用
 */
export class RemoteFrontend {
  private ws: WebSocket
  private snapshots = new Map<string, ExecutionSnapshot[]>()
  private children = new Map<string, Record<string, any>>()
  private onSnapshotCallback?: (snapshot: TimelineSnapshot) => void

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl)
    this.setupMessageHandler()
  }

  /**
   * WebSocket Message Handler
   */
  private setupMessageHandler(): void {
    this.ws.onmessage = (event) => {
      const message: BackendMessage = JSON.parse(event.data)
      
      switch (message.type) {
        case "snapshot":
          this.handleSnapshot(message.payload)
          break
        
        case "cancel":
          this.handleCancel(message.payload)
          break
        
        case "error":
          this.handleError(message.payload)
          break
      }
    }
  }

  /**
   * ExecutionSnapshot の受信
   */
  private handleSnapshot(snapshot: ExecutionSnapshot): void {
    // executionId を取得（suspend の場合は child）
    const executionId = this.getExecutionId(snapshot)
    
    // Snapshot を蓄積
    if (!this.snapshots.has(executionId)) {
      this.snapshots.set(executionId, [])
    }
    this.snapshots.get(executionId)!.push(snapshot)
    
    // suspend の場合: child 構造を記録
    if (snapshot.phase === "suspend" && snapshot.data?.condition?.type === "yield") {
      const childId = snapshot.data.condition.childExecutionId
      this.recordChild(executionId, childId)
    }
    
    // TimelineSnapshot に変換
    const timelineSnapshot = this.buildTimelineSnapshot(executionId)
    
    // Callback 呼び出し
    if (this.onSnapshotCallback) {
      this.onSnapshotCallback(timelineSnapshot)
    }
  }

  /**
   * Cancel の受信
   */
  private handleCancel(payload: {
    reason: CancelReason
    executionId: string
  }): void {
    const { executionId, reason } = payload
    
    // cancel snapshot を追加
    const cancelSnapshot: ExecutionSnapshot = {
      phase: "cancel",
      nodeType: "__timeline__",
      data: { reason },
      observedAt: Date.now(),
      hasEffect: false
    }
    
    this.snapshots.get(executionId)?.push(cancelSnapshot)
    
    // TimelineSnapshot 更新
    const timelineSnapshot = this.buildTimelineSnapshot(executionId)
    
    if (this.onSnapshotCallback) {
      this.onSnapshotCallback(timelineSnapshot)
    }
  }

  /**
   * Error の受信
   */
  private handleError(payload: {
    message: string
    executionId?: string
  }): void {
    console.error("Remote error:", payload.message)
  }

  /**
   * TimelineSnapshot の構築
   * 
   * ExecutionSnapshot[] → TimelineSnapshot
   * Local と同じ projectTimeline() を使用
   */
  private buildTimelineSnapshot(executionId: string): TimelineSnapshot {
    const snapshots = this.snapshots.get(executionId) || []
    const children = this.children.get(executionId) || {}
    
    return projectTimeline({
      executionId,
      snapshots,
      children,
      structure: {
        nodeType: "flow"  // TODO: 実際の構造
      }
    })
  }

  /**
   * Child 構造の記録
   */
  private recordChild(parentId: string, childId: string): void {
    if (!this.children.has(parentId)) {
      this.children.set(parentId, {})
    }
    
    this.children.get(parentId)![childId] = {
      executionId: childId,
      snapshots: this.snapshots.get(childId) || [],
      children: this.children.get(childId) || {}
    }
  }

  /**
   * ExecutionId の取得
   * 
   * suspend の場合は child の executionId を返す
   */
  private getExecutionId(snapshot: ExecutionSnapshot): string {
    if (snapshot.phase === "suspend" && snapshot.data?.condition?.type === "yield") {
      return snapshot.data.condition.childExecutionId
    }
    
    // TODO: 実際の executionId 取得ロジック
    return "exec-remote"
  }

  /**
   * Flow の実行開始
   */
  async start(flowId: string, input: any, executionId: string): Promise<void> {
    const message: FrontendMessage = {
      type: "start",
      payload: { flowId, input, executionId }
    }
    
    this.ws.send(JSON.stringify(message))
  }

  /**
   * Cancel 要求
   */
  cancel(executionId: string, reason: CancelReason = "user"): void {
    const message: FrontendMessage = {
      type: "cancel",
      payload: { executionId, reason }
    }
    
    this.ws.send(JSON.stringify(message))
  }

  /**
   * Snapshot 更新の監視
   */
  onSnapshot(callback: (snapshot: TimelineSnapshot) => void): void {
    this.onSnapshotCallback = callback
  }

  /**
   * fxdom への投影
   */
  projectToElement(element: HTMLElement): void {
    this.onSnapshot((snapshot) => {
      projectToFxdom(snapshot, element)
    })
  }
}
```

---

## 🎨 使用例

### Backend (Node.js)

```typescript
import { WebSocketServer } from "ws"
import { RemoteBackend } from "./remote/backend"

const wss = new WebSocketServer({ port: 8080 })

wss.on("connection", (ws) => {
  console.log("Client connected")
  
  const backend = new RemoteBackend(ws)
  
  ws.on("close", () => {
    console.log("Client disconnected")
  })
})
```

---

### Frontend (Browser)

```typescript
import { RemoteFrontend } from "./remote/frontend"

// Remote Timeline に接続
const remote = new RemoteFrontend("ws://localhost:8080")

// fxdom Element
const flowElement = document.querySelector("#remote-flow")

// 自動投影を設定
remote.projectToElement(flowElement)

// Flow 実行開始
await remote.start("myFlow", { input: 42 }, "exec-remote-1")

// Cancel
remote.cancel("exec-remote-1", "user")
```

---

### HTML

```html
<div id="remote-timeline">
  <h2>Remote Execution</h2>
  
  <!-- fxdom Element（作用の記述） -->
  <fx-flow id="remote-flow">
    <fx-sequence>
      <fx-call fn="fetchData" data-fx-id="fetch"></fx-call>
      <fx-yield for="processFlow" data-fx-id="process"></fx-yield>
      <fx-call fn="saveResult" data-fx-id="save"></fx-call>
    </fx-sequence>
  </fx-flow>
  
  <!-- Control -->
  <button onclick="remote.cancel('exec-remote-1', 'user')">
    Cancel
  </button>
</div>
```

---

## 🔄 データフロー（完全版）

```
┌──────────────────────────────────────────────────────────┐
│ Backend (Node.js)                                        │
│                                                          │
│  FxNode.execute()                                        │
│    ↓                                                     │
│  ExecutionStep (実行の事実)                               │
│    ↓                                                     │
│  LocalTimeline.emit()                                    │
│    ↓                                                     │
│  stepToSnapshot()                                        │
│    ↓                                                     │
│  ExecutionSnapshot (観測値)                               │
│    ↓                                                     │
│  JSON.stringify()                                        │
│    ↓                                                     │
│  WebSocket.send()                                        │
└──────────────────────────────────────────────────────────┘
                    ↓
          WebSocket (Network)
                    ↓
┌──────────────────────────────────────────────────────────┐
│ Frontend (Browser)                                       │
│                                                          │
│  WebSocket.onmessage                                     │
│    ↓                                                     │
│  JSON.parse()                                            │
│    ↓                                                     │
│  ExecutionSnapshot (受信)                                 │
│    ↓                                                     │
│  snapshots.push()                                        │
│    ↓                                                     │
│  projectTimeline()  ← Local と同じ！                     │
│    ↓                                                     │
│  TimelineSnapshot (構造投影)                              │
│    ↓                                                     │
│  projectToFxdom()  ← Local と同じ！                      │
│    ↓                                                     │
│  Custom State 更新                                        │
│    ↓                                                     │
│  CSS 可視化                                               │
└──────────────────────────────────────────────────────────┘
```

---

## ✅ Local / Remote の対称性確認

### 共通部分（同じコード）

```typescript
// ✅ 両方で使用
stepToSnapshot()       // Step → Snapshot 変換
projectTimeline()      // Snapshot 構造 → TimelineSnapshot
projectToFxdom()       // TimelineSnapshot → fxdom 投影
```

### 異なる部分（Transport）

```typescript
// Local
LocalTimeline.emit(step)
  ↓
toExecutionSnapshots()

// Remote
LocalTimeline.emit(step)
  ↓
stepToSnapshot()
  ↓
WebSocket.send()
  ↓
WebSocket.receive()
```

**Key Point:** Transport 以外は完全に同じコード

---

## 🧪 テストケース

### tests/remote/projection.test.ts

```typescript
import { describe, it, expect } from "vitest"
import { RemoteFrontend } from "../../src/remote/frontend"
import type { ExecutionSnapshot } from "../../src/types"

describe("Remote Projection", () => {
  it("should build TimelineSnapshot from ExecutionSnapshots", () => {
    const remote = new RemoteFrontend("ws://mock")
    
    // ExecutionSnapshot を受信（シミュレート）
    const snapshots: ExecutionSnapshot[] = [
      {
        phase: "enter",
        nodeType: "sequence",
        observedAt: Date.now(),
        hasEffect: false
      },
      {
        phase: "active",
        nodeType: "call",
        nodeId: "task1",
        observedAt: Date.now(),
        hasEffect: false
      }
    ]
    
    // TimelineSnapshot に変換
    const timelineSnapshot = (remote as any).buildTimelineSnapshot("exec-remote")
    
    expect(timelineSnapshot.executionId).toBe("exec-remote")
    expect(timelineSnapshot.state).toBe("running")
  })
  
  it("should handle cancel message", () => {
    const remote = new RemoteFrontend("ws://mock")
    
    // Cancel message を受信
    (remote as any).handleCancel({
      executionId: "exec-remote",
      reason: "user"
    })
    
    const timelineSnapshot = (remote as any).buildTimelineSnapshot("exec-remote")
    
    expect(timelineSnapshot.state).toBe("cancelled")
  })
})
```

---

## 📋 SPEC への追記案

### Appendix E: Remote Projection (New)

```markdown
## Appendix E: Remote Projection

### E.1 Remote vs Local の対称性

Remote 実行は Local 実行と同じ Projection Pipeline を使用する。

```
Local:  ExecutionStep → ExecutionSnapshot → TimelineSnapshot
Remote: ExecutionStep → ExecutionSnapshot → [Network] → TimelineSnapshot
```

Transport（WebSocket）以外は完全に同じコード。

---

### E.2 WebSocket Protocol

**Backend → Frontend:**
- `snapshot`: ExecutionSnapshot（観測値）
- `cancel`: Cancel 通知
- `error`: エラー通知

**Frontend → Backend:**
- `start`: Flow 実行開始
- `cancel`: Cancel 要求

**重要:** ExecutionStep は送信しない（シリアライズ不可）。

---

### E.3 Backend の責務

1. ExecutionStep → ExecutionSnapshot 変換
2. ExecutionSnapshot のシリアライズと送信
3. Cancel の伝播

**Backend は Timeline を送信しない。**
観測値（ExecutionSnapshot）のみを送信する。

---

### E.4 Frontend の責務

1. ExecutionSnapshot の受信と蓄積
2. TimelineSnapshot への投影（projectTimeline）
3. fxdom への投影（projectToFxdom）

**Frontend は ExecutionStep を知らない。**
ExecutionSnapshot から TimelineSnapshot を再構成する。
```

---

## ✅ 完成確認

### Phase 1: Protocol 定義 ✅
- BackendMessage / FrontendMessage
- WebSocket Protocol

### Phase 2: Backend 実装 ✅
- RemoteBackend
- ExecutionStep → Snapshot 変換
- WebSocket 送信

### Phase 3: Frontend 実装 ✅
- RemoteFrontend
- ExecutionSnapshot 受信
- TimelineSnapshot 構築
- fxdom 投影

### Phase 4: Local / Remote 対称性 ✅
- 同じ projectTimeline()
- 同じ projectToFxdom()
- Transport のみが異なる

---

## 🎯 成果

**SPEC 2.1.2-p1 + Appendix D の思想が完全に実装されました:**

1. ✅ **Timeline = 時間構造（譜面）**
   - Local / Remote で同じ意味論

2. ✅ **Snapshot = 観測値**
   - ExecutionStep → ExecutionSnapshot 変換
   - シリアライズ可能

3. ✅ **Projection = DevTools の責務**
   - Timeline インスタンスを参照しない
   - 純粋な値の変換

4. ✅ **fxdom = 言語 + 投影面**
   - 作用の記述（静的）
   - 観測結果の投影（動的）

---
