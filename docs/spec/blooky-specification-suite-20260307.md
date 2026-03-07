# blooky Specification Suite（全体構成案）

## 0. Core Concepts（共通語彙）

共通概念を一度だけ定義し、各仕様から参照する。

**目的**

* 用語の重複定義を防ぐ
* 語彙の意味を固定する

### 章構成

1. Overview
2. Terminology
3. Execution Concepts

   * Score
   * Note
   * Semantics
   * Profile
4. Runtime Concepts

   * Effect
   * Step
   * Runtime Interface
5. Dataflow Concepts

   * Prop
   * Stream
   * Dripper
6. Runtime Integration Concepts

   * RuntimeFx Adapter
7. Observability Concepts

   * Projection
   * Timeline

---

# 1. blooky-fp Specification

**FRP runtime**

### 章構成

1. Purpose
2. Core Types

   * Prop
   * Stream
   * Dripper
3. Prop Semantics
4. Stream Semantics
5. Drip Model
6. Commit Model
7. Graph Semantics
8. Derived Operators
9. Determinism Rules

役割

```
状態変化の数学モデル
```

---

# 2. blooky-clock Specification

**transaction runtime**

### 章構成

1. Purpose
2. Clock Interface
3. Tick Model
4. Submit Phase
5. Merge Phase
6. Conflict Detection
7. Observer Notification
8. Atomic Commit
9. Fatal Handling
10. Scheduler
11. Integration Rules

役割

```
state commit boundary
```

---

# 3. blooky-runtime-fx Specification

**Execution → Clock interface**

### 章構成

1. Purpose
2. RuntimeFx Interface
3. ExecutionStep Handling
4. Effect Extraction
5. Commit Submission
6. Observer Frames
7. Default RuntimeFx Adapter Implementation
8. Integration with Clock

役割

```
execution runtime adapter
```

---

# 4. score-fx Specification

**execution protocol**

### 章構成

1. Purpose
2. Score Model
3. Note Model
4. Execution Semantics
5. Step Emission
6. Yield / Suspend Model
7. Profile Integration
8. Effect Generation
9. Determinism Requirements

役割

```
what happens
```

---

# 5. blooky-fv Specification

**FRP → DOM runtime**

### 章構成

1. Purpose
2. FV Runtime Interface
3. PropBridge
4. DOM Projection Rules
5. Event Integration
6. Template Execution
7. Context Binding
8. Effect Elements
9. Determinism Constraints

役割

```
state → UI
```

---

# 6. blooky-projection Specification

**runtime observability**

### 章構成

1. Purpose
2. Projection Model
3. Runtime Observers
4. Timeline Projection
5. Graph Projection
6. DOM Projection
7. Failure Isolation
8. Semantics Preservation

役割

```
runtime visualization
```

---

# 7. blooky-devtools Specification

**debug runtime**

### 章構成

1. Purpose
2. DevTools Architecture
3. Projection Integration
4. Runtime Inspection
5. Step Execution Control

   * pause
   * resume
   * step
6. Debug UI Integration
7. Non-interference Rules

役割

```
debug runtime
```

---

# 8. Architecture Overview（横断仕様）

### 内容

1. System Overview
2. Layer Architecture
3. Data Flow
4. Write Path
5. Observation Path
6. Determinism Guarantees

---

# 最終レイヤー対応

| Layer               | Spec       |
| ------------------- | ---------- |
| Execution           | score-fx   |
| Runtime Interface   | runtime-fx |
| Transaction Runtime | clock      |
| Dataflow Runtime    | fp         |
| UI Runtime          | fv         |
| Observability       | projection |
| Debug Runtime       | devtools   |

---

# 書き込み経路

```
score-fx
  ↓
runtime-fx
  ↓
clock
  ↓
fp commit
  ↓
fv
```

---

# 観測経路

```
clock
  ↓
projection
  ↓
devtools
```

---
