# blooky-fp Functional Reactive Core Specification v1.0.0 (Draft)

**Project Name:** blooky-fp
**Version:** 1.0.0
**Status:** 🟡 Draft (Pre-Freeze)
**Scope:** Functional Reactive Programming Core Library
**Out of Scope:** Scheduling, Timeline, Execution, Observation, DevTools

---

## 0. Intent and Positioning

**blooky-fp** は、blooky 系列における **最小かつ不可欠な関数型リアクティブプログラミング（FRP）コア**である。

本仕様は以下を目的とする：

* 宣言的な **データフロー構造（Stream / Prop）** の定義
* 副作用を **値として表現する Effect モデル** の確立
* 実行・時間・観測から独立した **純粋なフロー意味論** の固定

blooky-fp は：

* 実行フレームワークではない
* スケジューラを持たない
* 非同期抽象（Promise / async）を扱わない

**時間・実行・観測はすべて上位層（例: blooky-fx / score-fx）の責務**である。

---

## 1. Core Concepts

### 1.1 Stream

**Stream** は、値が伝播する **有向グラフ構造**である。

* Stream は値を保持しない
* Stream は構造（接続関係）のみを表す
* 値は **drip** により注入される

Stream は以下の 2 種類の接続を持つ：

* **next**: 通常伝播（即時評価）
* **lazyNext**: 合流対象（reduce により遅延統合）

---

### 1.2 Prop

**Prop** は「現在値」を返す **時変値アクセサ**である。

```ts
type Prop<A> = () => A
```

* Prop は値を返す関数である
* Prop は **chained** な場合にのみ Stream と接続される
* Prop の更新は **Effect によってのみ**行われる

---

### 1.3 Effect

**Effect** は、値の変更を表す **差分更新計画**である。

```ts
type PropEffect<A> = [Prop<A>, A]
```

blooky-fp における Effect は：

* 実行命令ではない
* スケジューリング情報を持たない
* 値の同時更新を表現するための構造である

---

## 2. Drip and Collapse Model

### 2.1 DripEffect

```ts
type DripEffect<A> = {
  value: A
  dripper: DripperStream<A>
  effects: Map<Prop<any>, any>
}
```

**DripEffect** は、1 回の値注入（drip）に対応する Effect 集合である。

* `effects` は Prop → 次値の対応表
* この時点では **値はまだ適用されていない**

---

### 2.2 collapse(effect)

`collapse` は Effect を **実際の Prop 更新として適用**する操作である。

#### 規範

* `collapse` は `effect.effects` に含まれる **すべての更新を同一 tick における同時適用**として扱わなければならない（MUST）。
* 更新の適用順序に **意味を与えてはならない**（MUST NOT）。
* 観測可能な意味論として、`collapse` は
  **「すべての Prop が同時に次状態へ遷移した」**とみなされる（MUST）。

Map の列挙順序、内部実装の反復順は **仕様上無関係**である。

---

## 3. Synchronous-Only Rule

### 3.1 Promise Prohibition

blooky-fp v1.0.0 は **完全同期モデル**である。

#### 規範

* Stream に Promise が流入してはならない（MUST NOT）。
* Promise が検出された場合、実装は例外を送出しなければならない（MUST）。
* Promise を値として扱う拡張は **本仕様では永続的に対象外**とする。

時間・非同期性は blooky-fp の責務ではない。

---

## 4. Stream Operators Semantics

### 4.1 map

* 入力値を変換し、次の Stream に伝播する
* 変換関数は同期でなければならない

### 4.2 filter

* 入力値を述語で選別する
* 不一致の場合、値は伝播されない

### 4.3 merge

* 複数 Stream を合流させる
* 合流は **lazyNext** によって表現される
* 値は `reduceFn` により統合される

---

## 5. lift Semantics

`lift(f)(props)` は、複数 Prop を入力とする **合成 Prop** を生成する。

### 規範

1. **再計算トリガ**

   * upstream を持つ入力 Prop に更新が発生した場合、lift は再評価される（MUST）。

2. **再評価戦略**

   * 実装は、全入力 Prop を再読込してもよい（MAY）。
   * 実装は、更新元 Prop のみ差分反映してもよい（MAY）。

3. **結果一貫性**

   * 同一 tick における `collapse` の同時適用モデルにおいて、
     合成 Prop の観測値は入力値ベクトルに対して **一意に定まらなければならない**（MUST）。

再計算粒度や内部最適化は **観測結果が一致する限り自由**である。

---

## 6. Error Policy

blooky-fp は **ライブラリとして例外（throw）を許容する**。

### 方針

* 型不正・API misuse・仕様違反は例外として扱う
* エラーを値に変換する責務は **上位層**にある
* blooky-fp 自身は error-to-value を行わない

これは、blooky-fp が **ユーザーコードの骨格を形成するクリティカルなコア**であるためである。

---

## 7. Memory and Topology Management (Informative)

* `clear(stream)` は Stream グラフ構造と Prop 参照を切断する
* `disconnect(prop)` は Prop と Stream の関連のみを解除する
* GC / WeakMap / FinalizationRegistry の挙動は **実装依存**である

これらは **意味論ではなく実装補助**であり、規範対象ではない。

---

## 8. Out of Scope (Explicit)

以下は **blooky-fp v1.0.0 の対象外**とする：

* スケジューリング（tick / debounce / throttle）
* 観測・Observer・Snapshot
* 実行・Timeline・Runner
* 非同期 Stream / async flow
* 戦略付き Dripper

これらは上位レイヤーで定義されるべき関心事である。

---

## Appendix A: Core Type Definitions (Normative)

```ts
export type Prop<A> = () => A;

export type PropEffect<A> = [Prop<A>, A];

export type StreamBase<A, T> = {
  next: Set<MappedStream<any> | FilterStream<A>>;
  lazyNext: Set<MergedStream<A>>;
} & T;

export type DripperStream<A> = StreamBase<A, { isDripper: true }>;

export type MergedStream<A> = StreamBase<A, {
  reduceFn: (a: A, b: A) => A;
}>;

export type MappedStream<A> = StreamBase<A, {
  mapFn: <B>(v: B) => A;
}>;

export type FilterStream<A> = StreamBase<A, {
  filterFn: (v: A) => boolean;
}>;

export type Stream<A> =
  | DripperStream<A>
  | MappedStream<A>
  | MergedStream<A>
  | FilterStream<A>;

export type DripEffect<A> = {
  value: A;
  dripper: DripperStream<A>;
  effects: Map<Prop<any>, any>;
};

// Informative
export type Vertex = {
  sourceStream: Stream<any>;
  next: Vertex[];
  lazyNext: Vertex[];
  props: Prop<any>[];
};

export type FlowingState = [
  PropEffect<unknown>[],
  [MergedStream<any>, any][]
];
```

---

## Appendix B: Removed / Deferred Types (Informative)

以下は v1.0.0 から **削除または延期**された：

* DripStrategy / StrategicDripper
* PropObserver / CollapseObservationType
* CollapseReservation
* ClockEffect

これらは **時間・観測・実行層の関心事**であり、blooky-fp の責務ではない。

---

## 9. Frozen Intent (宣言)

blooky-fp v1.0.0 は、

* 同期 FRP コアとして凍結される
* 非同期モデルを取り込まない
* 上位層からの拡張を前提とする

---

**END OF DRAFT — blooky-fp v1.0.0**
