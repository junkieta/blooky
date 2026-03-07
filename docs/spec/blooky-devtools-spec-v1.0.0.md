# blooky DevTools Specification v1.0.0

**Subtitle:** Debug Runtime for blooky Execution
**Status:** Draft (aligned with Projection split)

---

# 1. Purpose and Scope

本仕様は、blooky における開発時専用の debug runtime (DevTools) を定義する。

DevTools は以下を提供する。

1. runtime state inspection
2. execution progression control
3. debug UI integration
4. development-time instrumentation

DevTools は Projection を利用して runtime を可視化する debug runtime であり、Projection 自体ではない。

DevTools は次を行ってはならない (MUST NOT)。

* Clock transaction semantics を変更する
* FRP commit semantics を変更する
* conflict resolution を行う
* runtime ordering を再定義する
* production runtime の意味論を変更する

DevTools は execution progression の制御のみを提供する。

---

# 2. Normative Positioning

DevTools は次の仕様に依存する。

* Clock Specification
* score-fx Specification
* Projection Specification
* blooky-fp Specification
* blooky-fv Specification (UI inspection を行う場合)

DevTools は runtime ordering authority を持たない。
runtime ordering authority は Clock Tick に存在する。
DevTools はこの ordering を再定義してはならない (MUST NOT)。

---

# 3. Architecture

DevTools は次の構造を持つ。

```text
Clock / Runtime
      ↓
Projection
      ↓
DevTools Runtime
   ├ Inspector
   ├ Execution Controller
   ├ Breakpoint Engine
   └ Debug UI
```

Projection は runtime state を view として提供する。
DevTools はそれを用いて debug runtime を構成する。

---

# 4. Inspection Surface

DevTools は runtime state の inspection を提供してよい (MAY)。

Inspection は read-only でなければならない (MUST)。

DevTools は以下の runtime state を inspect してよい。

* ObservedTick
* ObservedDripPlan
* execution step
* FRP graph metadata
* Prop / Stream metadata
* FxDOM binding metadata

Inspection は runtime state を変更してはならない (MUST NOT)。

---

# 5. Execution Progression Control

DevTools は execution progression control を提供してよい (MAY)。

以下の control が提供されてよい。

* pause
* resume
* single-step
* step-until
* breakpoint

これらは execution progression のみを制御する。

DevTools は以下を行ってはならない (MUST NOT)。

* Clock transaction semantics の変更
* commit ordering の変更
* conflict rule の変更
* FRP commit の直接実行

---

# 6. Pause / Resume Model

pause は execution progression を一時停止する debug command である。
resume は停止した execution progression を再開する debug command である。

pause は安全境界でのみ execution を停止しなければならない (MUST)。
安全境界は implementation-defined でよい (MAY)。

ただし次を破ってはならない (MUST NOT)。

* commit transaction 中断
* conflict Tick の成功化
* fatal error の回復

pause / resume は Clock transaction semantics に影響してはならない。

---

# 7. Step Model

single-step は execution progression を 1 step 前進させる debug command である。

step 単位は implementation-defined でよい (MAY)。

例:

* 1 execution step
* 1 yield / resume cycle
* 1 note activation

DevTools 実装は step 単位を公開文書で説明すべきである (SHOULD)。

step execution は以下を満たさなければならない (MUST)。

* Clock ordering を変更しない
* commit semantics を変更しない
* FRP transaction boundary を変更しない

---

# 8. Breakpoints

DevTools は breakpoint を提供してよい (MAY)。

breakpoint は execution progression を停止する条件である。

例:

* note id match
* execution step type
* effect kind
* tick index condition
* custom predicate

breakpoint は runtime state を変更してはならない (MUST NOT)。
breakpoint は execution progression の停止要求のみを行う。

---

# 9. Debug UI Integration

DevTools は debug UI を提供してよい (MAY)。

例:

* timeline viewer
* graph inspector
* step controls
* runtime state panel
* FxDOM overlay

これらは Projection の view を利用して構築されるべきである (SHOULD)。
Debug UI は runtime semantics に影響してはならない (MUST NOT)。

---

# 10. Development-Only Instrumentation

DevTools は development-only instrumentation を提供してよい (MAY)。

例:

* runtime labeling
* DOM debug overlay
* FxDOM inspection helpers
* debug events
* runtime state markers

これらは以下を満たさなければならない (MUST)。

* semantics-preserving
* removable in production
* failure-isolated

---

# 11. Production Separation

DevTools は production runtime から分離可能でなければならない (MUST)。

DevTools を無効化した場合でも runtime の意味論は変化してはならない (MUST)。

DevTools の存在は次に影響してはならない。

* commit ordering
* runtime semantics
* conflict behavior

---

# 12. Conformance

DevTools 実装が本仕様に適合するためには、少なくとも次を満たさなければならない。

1. execution progression control を提供する
2. runtime state inspection を提供する
3. Clock ordering authority を侵害しない
4. FRP commit semantics を変更しない
5. production runtime と分離可能である

---

# 13. Relationship to Projection

Projection は runtime state を可視化する契約である。
DevTools は Projection を利用する debug runtime である。

```text
Projection = runtime visualization
DevTools   = debug runtime
```

Projection は execution control を提供しない。
DevTools は execution control を提供する。

---
