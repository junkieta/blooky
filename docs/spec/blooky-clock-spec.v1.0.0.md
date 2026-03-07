# blooky Clock Specification v1.0.0

**Subtitle:** Tick Transaction Runtime for FRP Commit
**Status:** Draft

---

# 1. Purpose

Clock は blooky における **Tick 駆動の transaction runtime** を定義する。

Clock は次を保証する。

1. FRP 更新は **Tick 単位で atomic commit** される
2. 同一 Tick 内の競合は **commit 前に検出される**
3. Observer は **commit 予定の確定状態のみ観測する**


Clock は blooky runtime の **FRP commit transaction boundary** である。

blooky runtime が管理する FRP commit は
Clock を通じて行われなければならない (MUST)。

---

# 2. Clock Interface

Clock は次のインターフェースを提供する。

```
type Clock = Prop<number> & FVRuntime & {

  submitPlan(plan: DripPlan<any>): Promise<ObservedDripPlan>

  observeCommit(f: (plan: ObservedDripPlan) => void): (p: Prop<any>) => () => void

  unobserveCommit(f: (plan: ObservedDripPlan) => void): (p?: Prop<any>) => void

  observeTick(f: (tick: ObservedTick) => void): () => void

  unobserveTick(f: (tick: ObservedTick) => void): void

  setMergeStrategy<V>(dripper: DripperStream<V>, reducer: (a:V,b:V)=>V): void

  deleteMergeStrategy<V>(dripper: DripperStream<V>): void
}
```

Clock は `Prop<number>` としても振る舞い、Tick 値を FRP graph に公開する。

---

# 3. Tick Model

Clock は **Tick Transaction Model** を採用する。

1 Tick は次の段階で処理される。

```
Submit
Merge
Conflict Check
Observer Notify
Commit
Resolve
```

---

## 3.1 Submit Phase

`submitPlan(plan)` により DripPlan が予約される。

```
clock.submitPlan({ dripper, value })
```

submit は **次の scheduler cycle における future Tick** で処理される。

---

## 3.2 Merge Phase

同一 Tick 内に複数の DripPlan が存在する場合、
Clock は dripper 単位で入力を集約する。

Merge 規則:

```
1 value                → accept
2+ value + reducer     → merge
2+ value + no reducer  → DripConflict
```

MergeStrategy は dripper 単位で登録される。

---

## 3.3 Conflict Detection

Merge 後、Clock は commit intent を生成する。

commit intent は

```
(Prop, value)[]
```

の列である。

Clock は以下の conflict を検出する。

### Drip Conflict

同一 dripper に複数値が存在し merge strategy がない場合。

### Commit Conflict

同一 Prop に異なる値更新が存在する場合。

同値重複は MAY deduplicate。

---

## 3.3.1 Conflict Handling Rule

Clock は Drip Conflict または Commit Conflict を検出した Tick に対して次を MUST とする。

1. commit を実行しない
2. Tick Observer / Commit Observer を呼び出さない
3. 当該 Tick に含まれる submitPlan Promise を reject する

---

## 3.4 Normative Tick Order

Clock は conflict-free Tick に対して次の順序を維持しなければならない (MUST)。

```
Submit
→ Merge
→ Conflict Check
→ Observer Notify (pre-commit)
→ Commit
→ Resolve
```

Clock はこの外部可視順序を変更してはならない (MUST NOT)。

内部補助処理は許容されるが、
この外部可視順序を破ってはならない (MUST NOT)。

---

# 4. Atomic Commit

Conflict が存在しない場合、Clock は commit intent を FRP runtime に適用する。

```
commit([...commitPlan])
```

Commit は atomic であり、

* 中間状態
* 部分適用

は観測されてはならない (MUST NOT)。

---

# 5. ObservedTick

Tick Observer は **commit 実行前 (pre-commit)** に通知される。

```
type ObservedTick = {
  tick_index: number
  tick_id: number|string
  timestamp: number
  effects_summary: Map<Prop,value>
}
```

ObservedTick は **conflict-free commit intent の観測表現**である。

`effects_summary` は commit 結果ではなく、
pre-commit で確定した commit intent を表す。

Conflict が存在する Tick では ObservedTick を通知してはならない (MUST NOT)。

Observer failure は commit execution に影響してはならない (MUST NOT)。

---

# 6. Commit Observers

`observeCommit` は Prop 単位の更新観測を提供する。

Observer は commit された値のみ受け取る。

---

## 6.1 Commit Observer Delivery Rule

Commit Observer は conflict-free Tick に対してのみ通知されなければならない (MUST)。

Drip Conflict または Commit Conflict が発生した Tick では通知してはならない (MUST NOT)。

---

# 7. Merge Strategy

Clock は dripper 単位の merge strategy を登録できる。

```
clock.setMergeStrategy(dripper, reducer)
```

Reducer は同一 Tick 内の複数入力を 1 値に畳む。

例

```
last-write-wins
sum
max
average
```

Clock 自身は merge policy を規定しない。

---

# 8. Fatal Errors

commit 実行中の例外は **fatal error** として扱われる。

Clock は

* Tick queue を破棄
* scheduler を停止

しなければならない (MUST)。

---

## 8.1 Fatal Boundary Rule

Fatal Error は `submitPlan` の reject 経路に載せてはならない (MUST NOT)。

Fatal 発生時 Clock は次を MUST とする。

1. Tick 処理停止
2. Queue 破棄
3. FatalHandler へ制御移譲

---

# 9. Scheduler

Clock は scheduler により Tick を進める。

標準実装は

```
requestAnimationFrame
```

である。

ただし scheduler 実装は host に依存してよい。

---

# 10. Integration

Execution runtime は Clock.submitPlan を通じて
FRP commit transaction を要求する。

Clock は FRP commit transaction の唯一の boundary である。

Execution 側の `SemanticEvent -> PerformanceStep.effect -> runtime submit` の
出口マッピングは Semantics Registry Appendix A (Informative) を参照する。

---
