# blooky-fx Architecture Specification

**Version:** 1.0  
**Date:** 2026-02-03  
**Status:** Design Freeze

---

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Timeline Design Principles](#timeline-design-principles)
4. [ExecutionStep Semantics](#executionstep-semantics)
5. [Timeline Invariants](#timeline-invariants)
6. [Control Flow Design](#control-flow-design)
7. [RemoteTimeline Design](#remotetimeline-design)
8. [Step Observation (DevTools)](#step-observation-devtools)
9. [Prohibited Patterns](#prohibited-patterns)
10. [Future Extensibility](#future-extensibility)

---

## Overview

blooky-fx は関数型リアクティブプログラミング（FRP）の原則に基づいた、宣言的な非同期実行フレームワークです。

### Design Philosophy

1. **Timeline = 事実の記録者**  
   Timeline は ExecutionStep の直列化された事実であり、制御装置ではない。

2. **制御は構造で表現**  
   すべての実行制御は Fx ツリーまたは Prop で明示的に表現される。

3. **観測は特権**  
   ExecutionStep の観測は DevTools 専用の特権であり、通常のアプリケーション API には公開されない。

4. **Remote は包含される**  
   Remote 実行は呼び出し元の Fx ツリーに包含され、自律的に進行する。

---

## Change Policy

- この SPEC に定義された Invariants を破る変更は禁止する
- 新機能は Invariants を満たす形でのみ追加可能
- Invariants または Phase Semantics を変更する場合は
  Version を上げ、互換性破壊として扱う

---

## Core Concepts

### FxNode

実行可能な最小単位。各ノードは `execute()` メソッドで ExecutionStep を yield する。
```typescript
type FxNode =
  | FxSequenceNode    // 順次実行
  | FxParallelNode    // 並行実行
  | FxRaceNode        // 競合実行
  | FxCallNode        // 関数呼び出し
  | FxWaitNode        // 待機
  | FxConditionNode   // 条件分岐
  | FxSwitchNode      // 多分岐
  | FxLoopNode        // ループ
  | FxContextNode     // コンテキスト定義
  | FxCollapseNode    // Stream への値注入
  | FxYieldNode       // サブフロー呼び出し
  | FxReturnNode      // 戻り値設定
  | FxNoneNode        // 空操作
```

### ExecutionStep

FxNode の実行進行を表す不変の事実。
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
  | "suspend"   // 外部条件待ち
  | "resume"    // 待ちから復帰
  | "exit"      // 正常終了
```

### Timeline

ExecutionStep を順序通りに処理する責務を持つ。
```typescript
interface Timeline {
  readonly executionId: string
  emit(step: ExecutionStep): Promise<void>
  cancel(reason?: CancelReason): void
}
```

### DripEffect

FRP における状態更新の設計図。exit phase でのみ適用される。
```typescript
type DripEffect<A> = {
  dripper: DripperStream<A>
  value: A
  effects: Map<Prop<any>, any>
}
```

---

## Timeline Design Principles

### Principle 1: Timeline is a Fact Recorder, Not a Controller

Timeline は ExecutionStep の直列化された事実である。

**Timeline の責務:**
- ✅ Step を順序通りに emit する
- ✅ DripEffect を適用する（exit phase のみ）
- ✅ Suspend を管理する（Prop の監視）

**Timeline の非責務:**
- ❌ 実行フローを外部から変更する
- ❌ Step を改変する
- ❌ FxNode の実行ロジックに介入する
- ❌ 未来の実行を予測する

**理由:**

Timeline が制御装置になると、以下の問題が発生する:
- Fx ツリーに現れない制御が発生
- Replay / Time-travel が不可能
- DevTools が「なぜ止まったか」を説明できない
- Timeline の意味論が不安定化

---

### Principle 2: Control Must Be Explicit in Fx Tree or Prop

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

**正しい代替実装:**
```typescript
// ✅ 外部入力は Stream → Prop として注入
const pauseRequest$ = stream<boolean>();
const $pauseRequested = hold(false)(pauseRequest$);

fx.sequence([
  fx.call(ref('doWork')),
  fx.wait({ until: $pauseRequested }),  // ← Fx ツリーに明示
  fx.call(ref('continueWork'))
])

// UI から制御
button.onclick = () => collapse(drip(true)(pauseRequest$));
```

---

### Principle 3: Remote Execution is Encapsulated

Remote 実行は呼び出し元の Fx ツリーに包含される。
```
Caller Fx Tree
 └─ RemoteCallFx
     └─ (remote execution)
```

**制御の主権:**

- Remote 側の Timeline は**自律的に進行**する
- 呼び出し元は Remote の完了を**待つ**だけ
- 外部からの pause/resume は**因果関係を断絶**させる

**正しい実装パターン:**
```typescript
// Caller 側（Frontend）
const $remoteComplete = hold(false)(remoteCompleteStream$);

fx.sequence([
  fx.call(ref('startRemoteExecution')),  // WebSocket で開始
  fx.wait({ until: $remoteComplete }),   // 完了を待つ
  fx.call(ref('processResult'))
])

// Remote 側（Backend）- 独立して実行
fx.sequence([
  fx.call(ref('fetchData')),
  fx.call(ref('processData')),
  fx.collapse(true, ref('remoteCompleteStream$'))  // 完了を通知
])
```

**間違った実装パターン:**
```typescript
// ❌ Caller が Remote を直接制御
fx.sequence([
  fx.call(ref('startRemote')),
  // ← RemoteTimeline.pause() が外部から呼ばれる
  fx.call(ref('continueRemote'))
])

// 問題点:
// 1. Fx ツリーに現れない制御
// 2. Remote 側 Timeline に矛盾が生じる
// 3. 「なぜ止まったか」が不明
```

---

### Principle 4: Cancel is an Exception

`cancel` だけは Timeline の制御として許される。

**cancel と pause/resume の違い:**

| 項目 | cancel | pause/resume |
|------|--------|--------------|
| **意味** | 実行の否定 | 実行の再編成 |
| **Fx での表現** | 不要（緊急停止） | 必須（通常制御） |
| **Replay** | 可能（停止の事実） | 不可能（原因不明） |
| **DevTools 表示** | 「強制終了」 | 「原因不明の停止」 |
| **因果関係** | 歪めない | 断絶する |

**cancel が許される理由:**

1. **意味論を変えない**
   - 「やめる」という明確な意味
   - Fx の因果関係を歪めない

2. **Replay 不能でも問題ない**
   - 「途中で止まった」という事実が残る
   - 再生時も同じ地点で停止すればよい

3. **緊急時の必要性**
   - 無限ループの停止
   - リソースリークの防止
   - ユーザーによる明示的な中断

**使用例:**
```typescript
// ✅ Timeline の責務として cancel
const handle = execute(prepared);
handle.cancel("user");

// ✅ FxNode からの自然な終了
fx.return(ref('result'));  // ← これは cancel ではなく正常終了

// ❌ pause/resume は提供しない
// timeline.pause();   // ← これは提供しない
// timeline.resume();  // ← これは提供しない
```

---

## ExecutionStep Semantics

### Phase Definitions
```typescript
type ExecutionPhase =
  | "enter"     // ノードに入った（まだ何もしていない）
  | "active"    // ノードの処理を実行中
  | "suspend"   // 外部条件待ち（Prop が true になるまで）
  | "resume"    // suspend から復帰した瞬間
  | "exit"      // 正常終了（effect を適用する）
```

### Phase Transitions

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

### Data Semantics

| Phase | data | effect | 備考 |
|-------|------|--------|------|
| **enter** | `undefined` | - | ノードに入った瞬間 |
| **active** | メタデータ（任意） | - | 処理実行中の情報 |
| **suspend** | `{ until: Prop<boolean> }` | - | **必須**: 待機条件 |
| **resume** | `undefined` | - | 待機から復帰 |
| **exit** | 実行結果（任意） | `DripEffect`（任意） | 正常終了 |

**suspend の data 構造:**
```typescript
type SuspendCondition = // 将来的な拡張を見越したもの
  | {
      type: "prop"
      until: Prop<boolean> // 再開条件
    }
  // | {
  //      type: "timer"
  //      duration: number // タイムアウト（ms）
  //   }
  // | {
  //     type: "remote"
  //     event: string
  //   }

type SuspendData = {
  condition: SuspendCondition
  reason?: string              // 任意: 待機理由（DevTools 用）
}
```

**exit の effect:**
```typescript
// effect は CallNode でのみ生成される
type ExitStep = {
  phase: "exit"
  node: FxCallNode
  data: any              // 関数の戻り値
  effect?: DripEffect    // done が指定されている場合のみ
}
```

### Phase の不変性

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

## Timeline Invariants

これらの不変条件は blooky-fx の全実装で保証されなければならない。

### Invariant 1: Step Order Preservation

ExecutionStep は生成順に emit される。
```typescript
invariant: ExecutionStep は生成順序を保持する
// timestamp は参考情報であり、順序保証は Timeline が担う
```

**意味:**
- step の順序は決して入れ替わらない
- skip されない
- duplicate されない

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

**意味:**
- LocalTimeline と RemoteTimeline は同じ意味論
- DevTools が接続していなくても正常動作
- observer が throw しても Timeline は継続

**正しい実装:**
```typescript
class LocalTimeline {
  async emit(step: ExecutionStep) {
    // DevTools が接続していれば通知（optional）
    if (stepObservers.size > 0) {
      stepTick(step, this.executionId);
    }

    // 本来の処理（必須）
    if (step.phase === "suspend") {
      await this.handleSuspend(step);
    }

    if (step.phase === "exit" && step.effect) {
      await tick(step.effect);
    }
  }
}
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

**意味:**
- FxNode は Timeline の実装を知らない
- FxNode は「step を yield する」だけ
- 同じ FxNode が Local / Remote / Replay で動作

**違反例:**
```typescript
// ❌ Timeline の種類を判定
class BadNode {
  async *execute(ctx: ExecutionContext) {
    if (ctx.timeline instanceof RemoteTimeline) {
      // ❌ Timeline に依存した処理
    }
  }
}

// ❌ DevTools の存在を仮定
class BadNode {
  async *execute(ctx: ExecutionContext) {
    if (ctx.hasDevTools) {
      // ❌ DevTools に依存した処理
      yield { phase: "debug-info", ... };
    }
  }
}
```

---

### Invariant 4: Step Immutability

emit された ExecutionStep は変更されない。
```typescript
invariant: step は immutable
```

**意味:**
- Observer は step を変更できない
- DevTools は step を変更できない
- Transport は step を変更できない（serialize のみ）

**正しい実装:**
```typescript
// ✅ 新しい step を生成（FxNode 内）
yield { phase: "exit", node, data: result };

// ✅ step を観測（Observer 内）
stepClock.observe((effect) => {
  console.log(effect.step);  // ✅ read-only
});

// ❌ step を変更（禁止）
stepClock.observe((effect) => {
  effect.step.data = newData;  // ❌
});
```

---

### Invariant 5: Single Effect Application Point

DripEffect は exit phase でのみ apply される。
```typescript
invariant: tick(effect) は phase === "exit" のときのみ呼ばれる
```

**意味:**
- effect の適用タイミングは一箇所のみ
- enter / active / suspend / resume では effect を apply しない
- Timeline が責任を持って適用

**実装:**
```typescript
class LocalTimeline {
  async emit(step: ExecutionStep) {
    // ✅ exit のときのみ effect を適用
    if (step.phase === "exit" && step.effect) {
      await tick(step.effect);
    }

    // ❌ 他の phase では適用しない
  }
}
```

---

### Invariant 6: Suspend Resolution Guarantee

suspend した Step は必ず resume または cancel される。
```typescript
invariant: ∀ suspend step, ∃ (resume step ∨ cancel)
```

**意味:**
- suspend したら必ず何らかの形で解決される
- 永久に suspend したままにならない
- タイムアウト機構は必須ではないが推奨

**実装:**
```typescript
class LocalTimeline {
  private async handleSuspend(step: SuspendStep) {
    const untilProp = step.data.until;
    
    return new Promise<void>((resolve) => {
      const unobserve = clock.observe((effect) => {
        const resume = effect.effects.get(untilProp) === true;
        
        if (this.cancelled || resume) {
          unobserve();
          resolve();  // ✅ 必ず解決
        }
      })(untilProp);
    });
  }
}
```

---

### Invariant 7: Observer Non-Interference

stepClock.observe は Timeline の進行を妨げない。
```typescript
invariant: observer が throw しても Timeline は継続する
```

**意味:**
- observer のエラーは Timeline に伝播しない
- DevTools が壊れても実行は継続
- observer は「覗き窓」であり制御装置ではない

**実装:**
```typescript
export const stepTick = (step: ExecutionStep, executionId: string) => {
  stepObservers.forEach((nodes, f) => {
    if (nodes.has(step.node)) {
      try {
        f(stepEffect);  // ✅ try-catch で保護
      } catch (err) {
        console.error('[stepClock] Observer error:', err);
        // ✅ Timeline は継続
      }
    }
  });
};
```

---

## Control Flow Design

### Two Types of Control

blooky-fx における制御は 2 種類のみ。

#### 1. Structural Control（構造的制御）

Fx ツリーの構造として表現される制御。
```typescript
// 順次実行
fx.sequence([step1, step2, step3])

// 並行実行
fx.parallel([task1, task2, task3])

// 競合実行
fx.race([fast, slow])

// 条件分岐
fx.condition(test, thenBranch, elseBranch)

// 多分岐
fx.switch(value, cases, defaultBranch)

// ループ
fx.loop(cond, body)
```

**特徴:**
- ✅ Fx ツリーに明示的に現れる
- ✅ Replay / Time-travel 可能
- ✅ DevTools で可視化可能

---

#### 2. Data-Driven Control（データ駆動制御）

Prop の値変化によって制御される。
```typescript
// 待機
const $userConfirmed = hold(false)(confirmStream$);
fx.wait({ until: $userConfirmed })

// 条件付きループ
const $shouldContinue = hold(true)(continueStream$);
fx.loop($shouldContinue, fx.call(ref('process')))

// 動的分岐
const $branchKey = hold("default")(branchStream$);
fx.switch($branchKey, cases)
```

**特徴:**
- ✅ FRP の原則に従う
- ✅ 外部入力を Stream → Prop として注入
- ✅ Timeline が Prop を監視

---

#### ❌ Command Control（採用しない）

外部から Timeline を直接制御する方式は採用しない。
```typescript
// ❌ これらは提供しない
timeline.pause(executionId)
timeline.resume(executionId)
timeline.step(executionId)
timeline.goto(executionId, stepIndex)
```

**採用しない理由:**

1. **Fx ツリーに現れない**
   - 再生時に再現不可能
   - DevTools が説明できない

2. **因果関係の断絶**
   - 「なぜ止まったか」が不明
   - Timeline の意味論が歪む

3. **Prop で代替可能**
   - より明示的
   - より追跡可能

---

### External Input Integration

外部入力（HTTP / WebSocket / UI Event）は Stream → Prop として注入される。
```typescript
// ── 1. Stream を定義 ──
const pauseRequest$ = stream<boolean>();
const userInput$ = stream<string>();

// ── 2. Prop に変換 ──
const $pauseRequested = hold(false)(pauseRequest$);
const $userInput = hold("")(userInput$);

// ── 3. Fx で参照 ──
fx.sequence([
  fx.call(ref('doWork')),
  fx.wait({ until: $pauseRequested }),  // ← Prop を監視
  fx.call(ref('processInput'), { arg: $userInput })
])

// ── 4. 外部から値を注入 ──
button.onclick = () => {
  collapse(drip(true)(pauseRequest$));  // ← Stream に値を流す
};

input.oninput = (e) => {
  collapse(drip(e.target.value)(userInput$));
};
```

**このパターンの利点:**

1. ✅ すべての入力が Stream → Prop を経由
2. ✅ Fx ツリーに明示的に現れる
3. ✅ Timeline は Prop の変化を監視するだけ
4. ✅ Replay 時も同じ値を注入すれば再現可能

---

## RemoteTimeline Design

### Design Decision

**RemoteTimeline は観測専用 + cancel のみを提供する。**
```typescript
interface RemoteTimeline {
  readonly executionId: string
  
  // 観測（DevTools 専用）
  attach(): void
  detach(): void
  
  // 最小限の制御
  cancel(reason?: CancelReason): void
}
```

### 提供しない機能

- ❌ `pause(executionId: string)`
- ❌ `resume(executionId: string)`
- ❌ `step(executionId: string)`
- ❌ `goto(stepIndex: number)`

---

### Rationale

#### 1. Timeline の主権を守る

Remote 側の Timeline は**自律的に進行**する。
```
Frontend Timeline          Backend Timeline
     |                          |
     |-- execute(flow) -------->|
     |                          |-- enter
     |                          |-- active
     |                          |-- suspend
     |                          |-- resume
     |                          |-- exit
     |<-- result ---------------|
     |                          |
```

外部からの pause/resume は：
- Backend Timeline に矛盾を生じさせる
- 因果関係を断絶させる
- 「なぜ止まったか」が説明できなくなる

---

#### 2. Fx で表現可能

pause/resume は `wait({ until: $prop })` で代替可能。

**間違った設計:**
```typescript
// ❌ Frontend が Backend を直接制御
RemoteTimeline.pause(executionId);
// Backend 側で何が起きるか不明
```

**正しい設計:**
```typescript
// ✅ Frontend: Prop を更新
const pauseRequest$ = stream<boolean>();
const $pauseRequested = hold(false)(pauseRequest$);

// Backend: Fx で Prop を監視
fx.sequence([
  fx.call(ref('doWork')),
  fx.wait({ until: $pauseRequested }),  // ← Fx に明示
  fx.call(ref('continueWork'))
])

// Frontend: Stream に値を流す
button.onclick = () => {
  collapse(drip(true)(pauseRequest$));
  // ← WebSocket で Backend に送信される
};
```

---

#### 3. 因果関係の保持

すべての制御は Fx ツリーに現れなければならない。
```
Fx Tree (Backend)
 ├─ call: doWork
 ├─ wait: until $pauseRequested  ← ここで待機
 └─ call: continueWork

Timeline Steps
 ├─ enter: call:doWork
 ├─ exit: call:doWork
 ├─ enter: wait
 ├─ suspend: wait (until: $pauseRequested)  ← 待機理由が明確
 ├─ resume: wait
 ├─ exit: wait
 ├─ enter: call:continueWork
 └─ exit: call:continueWork
```

**DevTools で表示:**
```
fx-call: doWork (completed)
fx-wait: pauseRequested (suspended) ← なぜ止まっているか一目瞭然
fx-call: continueWork (pending)
```

---

### Why Cancel is Allowed

`cancel` だけは例外として許される。
```typescript
interface RemoteTimeline {
  cancel(reason?: CancelReason): void  // ✅ これは提供
}
```

**理由:**

1. **緊急停止の必要性**
   - 無限ループの停止
   - リソースリークの防止

2. **意味論を変えない**
   - 「やめる」という明確な意味
   - Fx の因果関係を歪めない

3. **Replay 可能**
   - 「途中で止まった」という事実が残る

---

### Remote Execution Pattern
```typescript
// ── Frontend ──

// 1. Remote 完了通知用の Stream
const remoteComplete$ = stream<boolean>();
const $remoteComplete = hold(false)(remoteComplete$);

// 2. Remote 実行を含む Fx
fx.sequence([
  fx.call(ref('startRemoteExecution')),  // WebSocket で開始
  fx.wait({ until: $remoteComplete }),   // 完了を待つ
  fx.call(ref('processResult'))
])

// 3. WebSocket で完了通知を受信
websocket.on('execution-complete', () => {
  collapse(drip(true)(remoteComplete$));
});

// ── Backend ──

// 1. 独立した Fx ツリー
fx.sequence([
  fx.call(ref('fetchData')),
  fx.call(ref('processData')),
  fx.collapse(
    { status: 'complete', result: ... },
    ref('resultStream$')
  )
])

// 2. 完了時に Frontend に通知
resultStream$.subscribe((result) => {
  websocket.send({ type: 'execution-complete', result });
});
```

**このパターンの特徴:**

- ✅ Backend は自律的に実行
- ✅ Frontend は待つだけ
- ✅ 因果関係が明確
- ✅ Replay 可能

---

## Step Observation (DevTools)

### Design Philosophy

**ExecutionStep の観測は DevTools 専用の特権である。**

- 通常のアプリケーション API には公開されない
- prod 環境では実質ゼロコスト
- FRP パターン（clock / stepClock）で統一

---

### stepClock API
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

### Usage Pattern
```typescript
// ── DevTools での使用 ──

// 1. Observer を定義
const stepObserver = (effect: StepClockEffect) => {
  const { step, executionId } = effect;
  
  // DOM 更新
  updateDevToolsUI(step);
  
  // CustomState 更新
  const element = getFxElement(step.node);
  const states = getCustomStates(element);
  states.delete(oldPhase);
  states.add(step.phase);
};

// 2. FxNode に Observer を登録
toFxNode(): FxNode {
  const result = super.toFxNode();
  
  // stepClock に登録
  const unobserve = stepClock.observe(stepObserver)(result);
  
  // DOM から切断時に自動 unobserve
  this.disconnectedCallback = () => unobserve();
  
  return result;
}
```

---

### Performance Characteristics

#### DevTools なし（prod）
```typescript
class LocalTimeline {
  async emit(step: ExecutionStep) {
    // observer がいなければ即座に return
    if (stepObservers.size === 0) {
      // ← ここで終了（コスト: Map.size チェックのみ）
    }
    
    // 本来の処理
    if (step.phase === "suspend") { ... }
    if (step.phase === "exit" && step.effect) { ... }
  }
}
```

**コスト:** `Map.size` のチェック（< 1ns）

---

#### DevTools あり（dev）
```typescript
class LocalTimeline {
  async emit(step: ExecutionStep) {
    // observer がいれば stepTick を呼ぶ
    if (stepObservers.size > 0) {
      stepTick(step, this.executionId);
      // ↓
      // 各 observer を実行
      // DOM 更新
    }
    
    // 本来の処理
    if (step.phase === "suspend") { ... }
    if (step.phase === "exit" && step.effect) { ... }
  }
}
```

**コスト:** observer 数 × `Set.has()` + DOM 更新

---

### clock vs stepClock

| 項目 | clock (Prop) | stepClock (FxNode) |
|------|--------------|-------------------|
| **ストリーム** | DripEffect | ExecutionStep |
| **配信関数** | tick() | stepTick() |
| **Observer** | clock.observe | stepClock.observe |
| **監視対象** | Prop | FxNode |
| **用途** | DOM 更新 | DevTools 更新 |
| **opt-in** | ❌（常時） | ✅（DevTools のみ） |
| **コスト** | 常に発生 | DevTools 時のみ |

**設計の対称性:**
```typescript
// Prop の監視（DOM 更新）
clock.observe((effect) => {
  effect.effects.forEach((value, prop) => {
    updateDOM(prop, value);
  });
})($myProp);

// FxNode の監視（DevTools 更新）
stepClock.observe((effect) => {
  updateDevTools(effect.step);
})(myFxNode);
```

---

## Prohibited Patterns

### FxNode Constraints

FxNode は Timeline / DevTools / Transport を知ってはならない。
```typescript
// ❌ Timeline に依存
class BadNode {
  async *execute(ctx: ExecutionContext) {
    if (ctx.timeline instanceof RemoteTimeline) {
      // ❌ Timeline の種類に依存した処理
    }
    
    ctx.timeline.pause();  // ❌ Timeline を直接操作
  }
}

// ❌ DevTools の存在を仮定
class BadNode {
  async *execute(ctx: ExecutionContext) {
    if (ctx.hasDevTools) {
      // ❌ DevTools に依存した処理
      yield { phase: "debug-info", ... };
    }
  }
}

// ✅ 正しい実装
class GoodNode {
  async *execute(ctx: ExecutionContext) {
    yield { phase: "enter", node: ctx.node };
    
    const result = await someWork();
    
    yield { phase: "exit", node: ctx.node, data: result };
    
    return result;
  }
}
```

---

### DevTools Constraints

DevTools は step を変更できない。
```typescript
// ❌ Step を変更
const badObserver = (effect: StepClockEffect) => {
  effect.step.phase = "paused";  // ❌ 変更禁止
  effect.step.data = newData;    // ❌ 変更禁止
};

// ❌ Timeline の進行を妨げる
const badObserver = (effect: StepClockEffect) => {
  while (true) {}  // ❌ 無限ループ
  throw new Error();  // ← throw しても Timeline は継続（保護されている）
};

// ✅ 正しい実装
const goodObserver = (effect: StepClockEffect) => {
  // Read-only で観測
  console.log('Step:', effect.step.phase);
  
  // DOM 更新
  updateDevToolsUI(effect.step);
  
  // CustomState 更新
  const element = getFxElement(effect.step.node);
  if (element) {
    const states = getCustomStates(element);
    states.add(effect.step.phase);
  }
};
```

---

### Transport Constraints

Transport は step を改変・破棄・並び替えできない。
```typescript
// ❌ Step を破棄
class BadTransport {
  async send(step: ExecutionStepJSON) {
    if (step.phase === "suspend") {
      return;  // ❌ suspend を送らない
    }
    await this.ws.send(step);
  }
}

// ❌ Step を並び替え
class BadTransport {
  private queue: ExecutionStepJSON[] = [];
  
  async send(step: ExecutionStepJSON) {
    this.queue.push(step);
    this.queue.sort((a, b) => a.priority - b.priority);  // ❌
    await this.ws.send(this.queue.shift());
  }
}

// ❌ Step を改変
class BadTransport {
  async send(step: ExecutionStepJSON) {
    step.phase = "modified";  // ❌
    await this.ws.send(step);
  }
}

// ✅ 正しい実装
class GoodTransport {
  async send(step: ExecutionStepJSON) {
    // そのまま送る
    await this.ws.send(step);
  }
}
```

---

## Future Extensibility

### Replay / Time-Travel

設計余地を確保するが、MVP には含めない。

#### 確保する設計余地

1. **Step の永続化可能性**
```typescript
   invariant: ExecutionStep は JSON serialize 可能
```

2. **Timeline の再現可能性**
```typescript
   invariant: 同じ step 列 → 同じ結果
```

3. **副作用の分離**
```typescript
   invariant: DripEffect は exit phase のみで apply
```

---

#### 将来の実装パターン（参考）

**Option A: Step の記録 + 再生**
```typescript
class ReplayTimeline implements Timeline {
  constructor(private steps: ExecutionStepJSON[]) {}
  
  async emit(step: ExecutionStep) {
    // 記録された step と一致するか検証
    const expected = this.steps[this.index++];
    
    if (!matchesStep(step, expected)) {
      throw new Error('Replay diverged at step ' + this.index);
    }
    
    // 通常の処理
    if (step.phase === "exit" && step.effect) {
      await tick(step.effect);
    }
  }
}
```

**Option B: Event Sourcing**
```typescript
class EventSourcedTimeline implements Timeline {
  constructor(private eventStore: EventStore) {}
  
  async emit(step: ExecutionStep) {
    // step を永続化
    await this.eventStore.append(step);
    
    // 通常の処理
    if (step.phase === "exit" && step.effect) {
      await tick(step.effect);
    }
  }
  
  async replay(fromTimestamp: number) {
    const steps = await this.eventStore.load({ from: fromTimestamp });
    
    for (const step of steps) {
      await this.emit(deserializeStep(step));
    }
  }
}
```

---

### Observer の拡張性

現在は `stepObservers: Map<Function, Set<FxNode>>` だが、将来的には observer の種類を区別できるようにする余地がある。
```typescript
// 現在
const stepObservers = new Map<Function, Set<FxNode>>();

// 将来（参考）
type ObserverType = "devtools" | "logger" | "replay" | "inspector";

const stepObservers = new Map
  ObserverType,
  Map<Function, Set<FxNode>>
>();

// 使用例
stepClock.observe(observer, { type: "devtools" })(node);
stepClock.observe(logger, { type: "logger" })(node);
```

**メリット:**
- observer の種類別に on/off 可能
- パフォーマンス最適化
- 責務の明確化

**現時点の判断:**
- MVP では単純な Map のまま
- 必要になったら追加

---

## Appendix A: Destructive Use Cases

将来的に検討すべき破壊的ユースケース。

### Case 1: attach/detach の高速繰り返し
```typescript
// シナリオ
for (let i = 0; i < 1000; i++) {
  await attach(executionId);
  await detach(executionId);
}

// 破壊の可能性:
// - stepObservers の add/delete が追いつかない
// - step が途中から欠落
// - メモリリーク

// 対策案:
// - attach/detach を debounce
// - 「最後の attach のみ有効」
// - observer の登録を遅延
```

---

### Case 2: Suspend の深いネスト
```typescript
// シナリオ
fx.sequence([
  fx.wait({ until: $cond1 }),
  fx.sequence([
    fx.wait({ until: $cond2 }),
    fx.sequence([
      fx.wait({ until: $cond3 }),
      // ... 100 層
    ])
  ])
])

// 破壊の可能性:
// - LocalTimeline.suspended Map がメモリリーク
// - 再開時の順序が狂う
// - Stack overflow

// 対策案:
// - suspend の深さ制限（警告）
// - WeakMap の利用
// - GC 可能な設計
```

---

### Case 3: Remote の step 欠落
```typescript
// シナリオ
Backend: emit("enter")
Backend: emit("active")
Backend: emit("suspend")  // ← ネットワークで欠落
Backend: emit("resume")
Backend: emit("exit")

// Frontend で受信:
["enter", "active", "resume", "exit"]
//                  ↑ suspend がない

// 破壊の可能性:
// - DevTools の表示が壊れる
// - phase transition が不正

// 対策案:
// - step に sequence number を付与
// - 欠落を検出して警告
// - または「ベストエフォート」として扱う
```

---

### Case 4: 大量並列実行
```typescript
// シナリオ
await Promise.all(
  Array.from({ length: 10000 }, (_, i) =>
    execute(prepare(fx.call(ref('task')), context))
  )
)

// 破壊の可能性:
// - stepObservers の Map が巨大化
// - stepTick のオーバーヘッド
// - メモリリーク

// 対策案:
// - executionId ごとに observer を分離
// - サンプリング（N 回に 1 回だけ通知）
// - バッチ化（複数 step をまとめて送信）
```

---

## Appendix B: Glossary

### 用語定義

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
| **RemoteTimeline** | Remote 実行を観測するための Timeline。制御権限は持たない。 |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| **1.0** | 2026-02-03 | 初版リリース（Design Freeze） |

---

## License

This specification is part of the blooky-fx project.

---

**END OF SPECIFICATION**