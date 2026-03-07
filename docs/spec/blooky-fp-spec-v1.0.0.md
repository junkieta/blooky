# blooky-fp Functional Reactive Core Specification v1.0.0

**Project Name:** blooky-fp
**Version:** 1.0.0
**Status:** 🔒 Final / Frozen
**Scope:** Functional Reactive Programming Core Library
**Out of Scope:** Scheduling, Timeline, Execution Control, Observer/Listener Mechanisms, DevTools

---

## 0. Intent and Positioning

**blooky-fp** は、blooky 系列における **最小かつ不可欠な関数型リアクティブプログラミング（FRP）コア**である。

本仕様の目的は以下である：

* 宣言的な **データフロー構造（Stream / Prop）** の定義
* 値更新を **Plan（更新計画）** として表現するモデルの確立
* 実行・時間・観測フックから独立した **純粋なフロー意味論の固定**

blooky-fp は：

* 実行フレームワークではない
* スケジューラを持たない
* タイムラインや履歴管理を持たない
* 非同期抽象（Promise / async）を扱わない
* 値変動に対するリスナー／Observer 機構を提供しない

Prop の値は **任意の場所から自由に読み取り可能（pull）**である。
ただし、値変動に伴う push 型通知機構は本仕様の対象外である。

---

# 1. Core Concepts

## 1.1 Stream

**Stream** は値が伝播する **有向グラフ構造**である。

* Stream は値を保持しない（MUST）
* Stream は接続構造のみを表す（MUST）
* 値は `drip` によって注入される（MUST）

Stream は以下の 2 種類の接続を持つ：

* `next`：同期評価における即時伝播辺
* `lazyNext`：合流点において reduce により統合される辺

### 規範

1. Stream グラフは `drip` により **同期的に評価可能**でなければならない（MUST）。
2. 評価が停止しない構造（循環依存など）は設計違反である（MUST NOT）。
3. 停止不能構造が検出された場合、実装は例外を送出しなければならない（MUST）。

---

## 1.2 Prop

```ts
type Prop<A> = () => A
```

Prop は値を返す関数である。

* Prop は値を保持するセルではなく、値を返すアクセサである
* Prop は Stream と接続された場合のみ自動更新される
* Prop の更新は `commit` によってのみ行われる（MUST）

### 規範

1. Prop の値は `commit` によってのみ変更されなければならない（MUST）。
2. Prop の読み取り（`p()`）は常に許可され、制限されない（MUST）。

---

## 1.3 Plan Model

### 1.3.1 PropPlan

```ts
type PropPlan<A> = [Prop<A>, A]
```

1 つの Prop の次状態を表す更新ペア。

---

### 1.3.2 DripPlan

```ts
type DripPlan = PropPlan<any>[]
```

DripPlan は複数の Prop 更新を表す列である。

* DripPlan は **状態を変更しない**（MUST）
* DripPlan は純粋な更新計画である（MUST）

### 規範

1. DripPlan 内で同一 Prop が複数回出現してはならない（MUST NOT）。
2. `drip` は同一 Prop を複数回含む DripPlan を生成してはならない（MUST NOT）。

---

## 1.4 DripperStream

DripperStream は外部から値を注入するための Stream である。

```ts
type DripperStream<A> = Stream<A>
```

### 規範

1. DripperStream は `drip(value)(dripper)` の起点である（MUST）。
2. DripperStream は値を保持してはならない（MUST NOT）。
3. DripperStream は commit を発生させてはならない（MUST NOT）。

---

# 2. Drip and Commit Model

## 2.1 drip

```ts
drip(value)(dripper) : DripPlan
```

`drip` は、`dripper` を起点として Stream グラフを **同期的に評価**し、DripPlan を生成する。

### 規範

1. `drip` は同期的に完了しなければならない（MUST）。
2. `drip` は DripPlan を返さなければならない（MUST）。
3. `drip` は commit を実行してはならない（MUST NOT）。
4. `drip` は部分的な更新計画を公開してはならない（MUST NOT）。
5. 同一入力と同一状態に対し、同一の DripPlan を生成しなければならない（MUST）。

---

## 2.2 commit

```ts
commit(plan: DripPlan): void
```

`commit` は DripPlan に含まれる更新を単一状態遷移として適用する。

### 規範

1. `commit` は plan に含まれるすべての Prop 更新を適用しなければならない（MUST）。
2. `commit` は更新適用以外の意味論（履歴管理・通知・タイムライン等）を導入してはならない（MUST NOT）。
3. `commit` は conflict 解決戦略を導入してはならない（MUST NOT）。

---

# 3. Conflict Semantics

```ts
conflict(plan: DripPlan): Set<Prop<any>>
```

同一 plan 内で同一 Prop が複数回出現する場合を検出する。

### 規範

1. DripPlan 内で同一 Prop が複数回出現してはならない（MUST NOT）。
2. conflict を含む plan を commit してはならない（MUST NOT）。
3. conflict 解決戦略（LWW 等）を提供してはならない（MUST NOT）。

Conflict は recoverable failure ではなく、設計違反または API misuse を表す。

---

# 4. Stream Operator Semantics

## 4.1 map

* `(v:A) => B` による同期変換
* Promise を返してはならない（MUST NOT）

## 4.2 filter

* 述語 `(v:A)=>boolean`
* false の場合伝播しない

## 4.3 merge

* 複数 Stream を合流
* `reduceFn` により値を統合
* 統合は lazyNext によって実現される

---

# 5. lift Semantics

```ts
lift(f)(props)
```

複数 Prop を入力とする合成 Prop を生成する。

### 規範

1. upstream Prop が更新された場合、再評価されなければならない（MUST）。
2. 同一 commit における同時更新モデル下で、観測値は一意に定まらなければならない（MUST）。
3. 実装は全入力を再読込してもよい（MAY）。

---

# 6. Synchronous-Only Rule

blooky-fp は完全同期モデルである。

### 規範

1. Stream に Promise を流してはならない（MUST NOT）。
2. Prop の値として Promise を扱ってはならない（MUST NOT）。
3. Promise が検出された場合、例外を送出しなければならない（MUST）。
4. これは recoverable failure ではなく設計違反を表す。

非同期抽象は上位層の責務である。

---

# 7. Error Policy

### 規範

1. blooky-fp は error-to-value 変換を行わない（MUST NOT）。
2. API misuse・型不整合・conflict・非同期混入は例外とする（MUST）。
3. これらの例外は recoverable failure ではなく設計違反である。
4. recoverable failure は上位層（clock/runtime integration）の責務である。

---

# 8. Memory and Topology Management

* `clear(stream)` は Stream 構造を切断する
* `disconnect(prop)` は Prop の接続を解除する

### 規範

1. clear / disconnect は構造的接続のみを変更しなければならない（MUST）。
2. clear / disconnect は Prop の値を変更してはならない（MUST NOT）。

---

# 9. Explicit Non-Goals

blooky-fp v1.0.0 は以下を提供しない（MUST NOT）：

* 履歴管理・rollback・タイムトラベル
* push 型 Observer/Listener 機構
* 非同期制御
* commit の部分適用
* conflict 解決戦略

---

# 10. Frozen Declaration

🔒 **blooky-fp v1.0.0 is Frozen**

* commit は単一状態遷移である
* Plan は純粋な更新計画である
* 非同期は扱わない
* conflict は設計違反である
* recoverable failure は上位層の責務である

---

**END OF SPECIFICATION — blooky-fp v1.0.0**
