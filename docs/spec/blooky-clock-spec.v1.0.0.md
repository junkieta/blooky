# blooky Clock Specification v1.0.0 (Draft)

**Subtitle:** Tick Transaction Boundary for FRP Commit
**Status:** Draft (aligned with runtime refactor)

---

# 1. Purpose

Clock は、blooky における **Tick 駆動と Commit Transaction の境界**を定義する統合インターフェースである。

Clock は以下を保証する。

1. FRP 更新は **Tick 単位で atomic commit** される
2. 同一 Tick 内の競合は **commit 前に検出される**
3. Observer は **commit 予定の確定状態のみ観測する**

Clock は commit transaction の唯一の書き込み境界 (write boundary) を提供する。
読み取り経路は FRP graph によって提供され、Clock を経由することを要求しない。

---

# 2. Clock Interface

Clock は以下のインターフェースを提供する。

```ts
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

Clock は **Prop<number>** としても振る舞い、Tick 値を FRP に公開する。

---

# 3. Tick Model

Clock は **Tick Transaction Model** を採用する。

1 Tick は以下の段階で構成される。

```
Submit Phase
Merge Phase
Conflict Check
Observer Notify
Commit
Resolve
```

---

## 3.1 Submit Phase

`submitPlan(plan)` により DripPlan が予約される。

```ts
clock.submitPlan({
  dripper,
  value
})
```

submit は **次の scheduler cycle** における future Tick で処理される。

---

## 3.2 Merge Phase

同一 Tick 内に複数の DripPlan が到着した場合、Clock は dripper 単位で入力を集約する。

Merge は以下の規則で行われる。

1. 入力が 1 値の場合、その値を受理する。
2. 入力が 2 値以上で MergeStrategy が登録されている場合、reducer を適用する。
3. 入力が 2 値以上で MergeStrategy が未登録の場合、**DripConflict** とする。

---

## 3.3 Conflict Detection

Merge 後、Clock は commit intent を生成する。

commit intent は `(Prop,value)` の列である。

Clock は以下の conflict を検出する。

### Drip Conflict

同一 dripper に複数値が存在し、merge strategy が無い場合。

### Commit Conflict

同一 Prop に異値更新が存在する場合。

同値重複は MAY deduplicate。

## 3.3.1 Conflict Handling Rule (Normative)

Clock は Drip Conflict または Commit Conflict を検出した Tick について、以下を MUST とする。

1. 当該 Tick の commit を実行しない。
2. 当該 Tick の Tick Observer および Commit Observer を呼び出さない。
3. 当該 Tick に含まれる `submitPlan` Promise を reject する。

---

## 3.4 Normative Tick Order

Clock は conflict-free な Tick において、外部可視順序を次の順序で処理しなければならない (MUST)。

```
Submit -> Merge -> Conflict Check -> Observer Notify (pre-commit) -> Commit -> Resolve
```

Clock はこの外部可視順序を変更してはならない (MUST NOT)。

---

# 4. Atomic Commit

Conflict が存在しない場合、Clock は commit intent を FRP に適用する。

```
commit([...commitPlan])
```

Commit は **atomic** であり、

* 中間状態
* 部分適用

は観測されてはならない。

---

# 5. ObservedTick

Tick Observer は commit 実行前 (pre-commit) に通知される。

```
type ObservedTick = {
  tick_index: number
  tick_id: number|string
  timestamp: number
  effects_summary: Map<Prop, value>
}
```

ObservedTick は、当該 Tick において commit 実行前に確定した conflict-free commit intent の観測表現である。

`effects_summary` は commit 後の結果ではなく、pre-commit で確定した conflict-free commit intent を表す。

Conflict が検出された Tick では ObservedTick は通知してはならない (MUST NOT)。

Observer は commit の成功／失敗には影響しない。
Observer failures MUST NOT affect commit execution.

---

# 6. Commit Observers

`observeCommit` は Prop 単位の更新観測を提供する。

Observer は commit された値のみ受け取る。

## 6.1 Commit Observer Delivery Rule

Commit Observer は conflict-free な Tick に対してのみ通知されなければならない (MUST)。

Drip Conflict または Commit Conflict が発生した Tick では、Commit Observer を通知してはならない (MUST NOT)。

---

# 7. Merge Strategy

Clock は dripper 単位の merge strategy を登録できる。

```
clock.setMergeStrategy(dripper, reducer)
```

Reducer は同一 Tick 内の複数入力を 1 値に畳む。

例:

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

* Tick Queue を破棄
* Scheduler を停止

する。

Host は FatalHandler を登録できる。

## 8.1 Fatal Boundary Rule

Fatal Error は `submitPlan` の通常 reject 経路に載せてはならない (MUST NOT)。

Fatal 発生時、Clock は以下を MUST とする。

1. 以後の Tick 処理を停止する。
2. 保留中 Tick Queue を破棄する。
3. FatalHandler に制御を移譲する。

---

# 9. Scheduler

Clock は Tick を scheduler によって進める。

標準実装は

```
requestAnimationFrame
```

である。

ただし scheduler 実装は host に依存してよい。

---

# 10. Bridge Integration

Bridge は Clock を通じて commit を要求する。

```
bridge.onStep(step)
    ↓
clock.submitPlan(...)
```

Bridge は Tick の管理を行わない。

---

# 11. DevTools Integration

DevTools Timeline は Clock Tick を基準に構築される。

```
Timeline authority = Clock Tick
```

Bridge は Timeline の主権を持たない。
Timeline events are derived from Clock observers.

---

# 12. Implementation Notes (Non-Normative)

Clock の典型実装は以下の構成を取る。

```
Clock (facade)
 ├ scheduler
 ├ tick-gate
 └ commit-runtime
```

Clock はこれらの内部構造を公開しない。

---
