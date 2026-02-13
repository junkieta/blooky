# blooky-fp Functional Reactive Core Specification v1.0.0 (Draft — Revised)

**Project Name:** blooky-fp
**Version:** 1.0.0
**Status:** 🟡 Draft (Pre-Freeze)
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

## 1. Core Concepts

### 1.1 Stream

**Stream** は値が伝播する **有向グラフ構造**である。

* Stream は値を保持しない
* Stream は接続構造のみを表す
* 値は `drip` により注入される

Stream は以下の 2 種類の接続を持つ：

* `next`：即時伝播
* `lazyNext`：合流対象（reduce により統合）

---

### 1.2 Prop

```ts
type Prop<A> = () => A
```

Prop は値を返す関数である。

* Prop は値を保持するセルではなく、値を返すアクセサである
* Prop は Stream と接続された場合 **chained** のみ自動更新される
* Prop の更新は `commit` によってのみ行われる

Prop の読み取り（`p()`）は常に許可され、制限されない。

---

### 1.3 Plan Model

### 1.3.1 PropPlan

```ts
type PropPlan<A> = [Prop<A>, A]
```

1つの Prop の次状態を表す更新ペア。

---

### 1.3.2 DripPlan

```ts
type DripPlan = PropPlan<any>[]
```

DripPlan は複数の Prop 更新を表す列である。

* DripPlan は **状態を変更しない**
* DripPlan は純粋な「更新計画」である

---

## 2. Drip and Commit Model

### 2.1 drip

```ts
drip(value)(dripper) : DripPlan
```

* Stream グラフを評価し、更新計画を生成する
* 状態はまだ変更されない

---

### 2.2 commit

```ts
commit(plan: DripPlan): void
```

#### 規範

1. `commit` は plan に含まれるすべての Prop 更新を **単一の状態遷移として適用しなければならない（MUST）**
2. `commit` は DripPlan の適用以外の意味論を導入してはならない（MUST NOT）。
   具体的には、履歴管理・ロールバック・通知・タイムライン等の追加機能を提供してはならない。。

---

## 3. Conflict Semantics

### 3.1 conflict(plan)

```ts
conflict(plan: DripPlan): Set<Prop<any>>
```

同一 plan 内で同一 Prop が複数回出現する場合を検出する。

#### 規範

* DripPlan 内で同一 Prop が複数回出現してはならない（MUST NOT）
* conflict が存在する plan を commit してはならない（MUST NOT）

競合は設計上の誤りとみなされる。

blooky-fp は競合解決戦略（LWW 等）を提供しない。

---

## 4. Stream Operator Semantics

### 4.1 map

* `(v:A) => B` による同期変換
* 出力 Stream<B> を生成
* Promise を返してはならない（MUST NOT）

### 4.2 filter

* 述語 `(v:A)=>boolean` による選別
* false の場合、伝播されない

### 4.3 merge

* 複数 Stream を合流
* `reduceFn` により値を統合
* 統合は lazyNext によって実現される

---

## 5. lift Semantics

`lift(f)(props)` は複数 Prop を入力とする合成 Prop を生成する。

### 規範

1. upstream を持つ Prop が更新された場合、再評価される（MUST）
2. 実装は全入力を再読込してもよい（MAY）
3. 同一 commit における同時更新モデル下で、観測値は一意に定まらなければならない（MUST）

---

## 6. Synchronous-Only Rule

blooky-fp は完全同期モデルである。

* Stream に Promise を流してはならない（MUST NOT）
* Promise が検出された場合、例外を送出しなければならない（MUST）

非同期抽象は上位層の責務である。

---

## 7. Error Policy

* API misuse・型不整合・conflict は例外とする
* blooky-fp は error-to-value 変換を行わない
* 例外制御は上位層の責務とする

---

## 8. Memory and Topology Management (Informative)

* `clear(stream)` は Stream 構造を切断する
* `disconnect(prop)` は Prop の接続を解除する
* GC 挙動は実装依存である

---

## 9. Explicit Non-Goals

blooky-fp v1.0.0 は以下を提供しない（MUST NOT）：

* 履歴管理・rollback・タイムトラベル（Timeline/Execution Control）
* 値変動に伴う Observer/Listener 登録・通知機構（push observation）

---

## 10. Frozen Intent

blooky-fp v1.0.0 は：

* 同期 FRP コアとして凍結される
* commit を単一状態遷移と定義する
* 履歴・通知・時間概念を内部に持たない
* 上位層拡張を前提とする

---

**END OF DRAFT — blooky-fp v1.0.0**
