# blooky-fv Specification v1.0.0

**Subtitle:** DOM Binding & Context Propagation Layer  
**Status:** 🔒 Final / Frozen  
**Depends on:**
- blooky-fp v1.0.0
- blooky-fx Bridge v1.0.0

**Scope:** FRP → DOM Projection Adapter, Event → Runtime Adapter

---

## 0. Purpose and Scope

blooky-fv は blooky-fp によって構築された FRP グラフを DOM に投影し、DOM イベントを runtime に接続するバインディング層である。

### 本仕様が規定するもの

1. **JSHTML → DOM 投影**: Prop と DOM の接続モデル
2. **Runtime 観測契約**: runtime.observe / unobserve インターフェース
3. **Context 伝搬モデル**: 初期化時の context 注入規則
4. **Event Adapter**: DOM イベント → runtime.submit 変換
5. **Custom Element Hooks**: カスタム要素処理契約

### 本仕様が規定しないもの

- FRP 演算意味論（fp の責務）
- Tick / commit / conflict 解決（fx bridge の責務）
- スケジューリング（runtime の責務）
- DevTools 表示仕様

### 設計原則

**blooky-fv は意味論を持たない。**

fv は Prop 値の解釈や実行戦略を導入してはならない（MUST NOT）。
すべての実行制御は runtime と fx bridge に委譲される。

---

## 1. Core Model

### 1.1 PropBridge

PropBridge は `Prop<A>` と DOM 表現を接続するオブジェクトである。

```ts
interface PropBridgeInterface<A> {
  prop: Prop<A>
  isConnected(): boolean
  update(next: A, prev: A): void
  contains(other: PropBridge): boolean
}
```

#### 規範

- `update` は DOM 表現のみを更新しなければならない（MUST）
- `update` は Prop の値を変更してはならない（MUST NOT）
- `contains` は DOM 範囲包含判定のみを行う（MUST）
- PropBridge は FRP commit を発生させてはならない（MUST NOT）
- `isConnected()` は DOM 接続状態を正確に返さなければならない（MUST）

#### PropBridge の責務

PropBridge は以下の条件を満たす（MUST）:

- **局所性**: ひとつの PropBridge は 1 つの DOM 反映点のみを担当する
- **疎結合**: runtime の commit 意味論を知らず、通知された値を DOM に反映するのみ
- **寿命管理**: DOM から外れた反映点は `isConnected()` で検出される

---

### 1.2 Bridge Record

fv は以下のレコードを保持する。

```ts
Map<Prop<any>, PropBridge[]>
```

このレコードは DOM 投影管理専用である。

#### 規範

- Bridge Record は Prop→Bridge の多対多関係を表す（MUST）
- 同一 Prop が複数の DOM 箇所に bind される場合を想定する（MUST）
- Record は GC により動的に変化する（MAY）

---

## 2. Runtime Interface Contract

fv は commit を直接呼び出さない。
runtime を通じてのみ FRP 実行を要求する。

### 2.1 Required Runtime Interface

```ts
export interface FVRuntime {
  /**
   * plan を予約し、commit 完了を Promise で返す。
   * resolve: commit 成功（commit済み）
   * reject: conflict または commit failure
   */
  submit(plan: DripPlan): Promise<DripPlan>

  /**
   * 観測関数 f を登録し、観測対象 prop を追加する関数を返す。
   * f は ObservedPlan（view）を受け取る。
   * 返り値は当該 prop の購読解除関数（unobserver）。
   */
  observe(f: (plan: ObservedPlan) => void): (p: Prop<any>) => () => void

  /**
   * 観測解除。
   * - p 指定あり: 当該 prop のみ解除
   * - p 省略: f 全体を解除
   */
  unobserve(f: (plan: ObservedPlan) => void): (p?: Prop<any>) => void
}
```

#### 規範

- `submit` は commit 完了時に resolve しなければならない（MUST）
- `submit` は conflict や commit failure の場合 reject しなければならない（MUST）
- `observe` は Prop 単位で購読を登録しなければならない（MUST）
- `observe` の返り値は購読解除関数（unobserver）を返す関数でなければならない（MUST）
- `unobserve` は購読解除を行わなければならない（MUST）
- `unobserve(f)()` は f に紐づく全購読を解除しなければならない（MUST）
- `unobserve(f)(p)` は f の p に対する購読のみを解除しなければならない（MUST）

---

## 3. Observation Wiring

### 3.1 ObservedPlan

`ObservedPlan` は runtime から通知される更新集合である。

```ts
export type ObservedPlan = DripPlan
```

ObservedPlan は commit-plan から生成される観測用 view である。

#### ObservedPlan View Contract（規範）

- runtime が observer に渡す更新集合は `ObservedPlan` でなければならない（MUST）
- ObservedPlan は commit-plan の subset であってよい（MAY）
- ObservedPlan 生成は commit-plan を変更してはならない（MUST NOT）
- fv は ObservedPlan を DOM 更新のみに使用する（MUST）
- fv は ObservedPlan を編集してはならない（MUST NOT）
- fv は ObservedPlan を commit 制御に使用してはならない（MUST NOT）
- fv は ObservedPlan の subset 性（通知が部分集合であり得る）を前提として処理しなければならない（MUST）

---

### 3.2 Subscription Lifecycle

#### Observe Handle（規範）

`runtime.observe(f)` は、Prop を購読対象として追加し、当該 Prop の **購読解除関数（unobserver）** を返す関数を返さなければならない（MUST）。

fv は、各 Prop について対応する unobserver を保持してよい（MAY）。

#### 規範

1. PropBridge が初めて生成された際、fv は `runtime.observe` を通じて購読登録を行う（MUST）
2. 対応する PropBridge がすべて除去された場合、fv は対応する unobserver を呼び出さなければならない（MUST）
3. 購読解除は **Prop 単位**で行う（MUST）
4. 同一 Prop に複数 bridge が存在する場合、最後の bridge が除去された時点で解除されなければならない（MUST）

---

### 3.3 Atomicity Preservation

fv は fx bridge による atomic commit モデルを破壊してはならない（MUST NOT）。

- ObservedPlan の 各通知は **単一の commit の結果**として扱わなければならない（MUST）
- fv は ObservedPlan 内の更新を++段階的に適用**してはならない（MUST NOT）

---

## 4. Binding Semantics

### 4.1 Node Binding（RangePropBridge）

JSHTML node source が `Prop<JSHTMLNodeSource>`（chained）である場合：

- fv は Prop を RangePropBridge に bind しなければならない（MUST）
- 更新時、対応する DOM Range を置換する（MUST）

---

### 4.2 Attribute Binding（AttrPropBridge）

要素属性が chained prop である場合：

- fv は AttrPropBridge を bind しなければならない（MUST）
- 更新時、属性値を更新する（MUST）

---

### 4.3 Style / Dataset Binding

- `style` 内の chained prop は StylePropBridge に bind される（MUST）
- `dataset` 内の chained prop は DatasetPropBridge に bind される（MUST）

---

### 4.4 Update Condition

fv は以下の場合のみ DOM を更新してよい（MAY）：

```ts
if (prev !== next)
```

ただしこれは最適化であり意味論ではない。

---

## 5. Context Propagation

### 5.1 Context Model

Context は DOM 生成時に FRP フローを接続する結節点である。

#### 規範

1. `context` は生成時にのみ参照される（MUST）
2. fv は生成後に `context` の変更を追跡してはならない（MUST NOT）
3. `context` の差し替えは生成関数の再呼び出しと同義である（MUST）
4. `context` は FRP 値として解釈されない（MUST NOT）

---

### 5.2 prime Contract

```ts
const prime = <T>(fn: (ctx: T) => JSHTMLNodeSource) =>
  (ctx: T) => jshtml(fn(ctx), ctx)
```

#### 規範

- `prime` は context を jshtml に伝搬しなければならない（MUST）
- context は子孫ノードへ伝搬される（MUST）

---

## 6. Custom Element Hooks

### 6.1 JSHTML_ELEMENT_HANDLER

```ts
const JSHTML_ELEMENT_HANDLER: unique symbol
```

#### 規範

- 要素生成直後に一度だけ呼び出される（MUST）
- 戻り値は意味を持たない（MUST NOT 依存）

---

### 6.2 JSHTML_ATTR_HANDLER

```ts
const JSHTML_ATTR_HANDLER: unique symbol
```

形式：

```ts
{
  [attrName: string]: (runtime: JSHTMLAttrRuntime<any>) => boolean | void
}
```

#### 規範

- 属性処理前にハンドラを呼び出す（MUST）
- `false` が返された場合、標準処理を実行してはならない（MUST NOT）

---

## 7. PropBridge Lifecycle

### 7.1 Bridge GC（規範）

fv は、以下の bridge をレコードから除去しなければならない（MUST）。

1. `PropBridge.isConnected()` が false となった bridge
2. 他の bridge に包含される bridge（`contains` により判定される場合）

包含関係が成立する場合、包含される側（内側）を除去してよい（MAY）。

---

### 7.2 Unobserve on Empty（規範）

fv は、ある Prop に対応する bridge がすべて除去された時点で、当該 Prop を購読対象から除去しなければならない（MUST）。

- 購読解除は **Prop 単位**で行う（MUST）
- 同一 Prop に複数 bridge が存在する場合、最後の bridge が除去された時点で解除されなければならない（MUST）
- 解除は `runtime.observe(f)(prop)` が返す **unobserver を呼び出す**ことで行われなければならない（MUST）

---

### 7.3 Separation of Concerns（規範的明確化）

fv における **bridge の除去（DOM binding の解除）**と、runtime に対する **購読解除（unobserve）**は概念的に異なる。

- bridge 除去は fv 内部状態の管理である
- unobserve は runtime 契約に基づく購読管理である

fv 実装はこれらを同一関数内で行ってもよい（MAY）が、意味論として混同してはならない（MUST NOT）。

---

## 8. Event → Runtime Adapter

### 8.1 listenerForSubmit

fv は `listenerForSubmit` を提供する。

`listenerForSubmit(d)(ev)` は：

1. `plan = drip(ev)(d)` を生成する（MUST）
2. `runtime.submit(plan)` を呼ぶ（MUST）
3. resolve / reject 処理（MUST）
・ listener の返り値は意味を持たない（MUST NOT 依存）

---

### 8.2 Event Projection（Informative）

fv は `runtime.submit` の結果を DOM CustomEvent として投影してよい（MAY）。

例：

- `blooky-commit-start`（cancelable）
- `blooky-commit-completed`
- `blooky-commit-failed`
- `blooky-commit-cancelled`

これらは仕様上必須ではない。実装依存である。

**Note:** DOM CustomEvent による start/completed/failed 等の通知は、fv の外部投影であり規範ではない（Informative）。fv 実装は必要に応じて提供してよい（MAY）。

---

## 9. Design Consequences

本仕様により：

- **fv は純粋な Projection 層となる**: 実行意味論を持たない
- **実行意味論は runtime / bridge に固定される**: fv は観測のみ
- **context は初期化境界として凍結される**: 生成後は変更しない
- **DOM と FRP の責務分離が明確になる**: fv は投影のみを担当
- **ObservedPlan は view である**: commit-plan の編集権限を持たない

---

## 10. Non-goals

fv は以下を提供しない：

- tick / clock / scheduling
- commit / conflict 解決
- observer failure policy
- plan editing / rewriting

これらは runtime と fx bridge の責務である。

---

## 11. Frozen Declaration

🔒 **本仕様は v1.0.0 として凍結する。**

凍結内容：

- context は immutable（生成時のみ使用）
- fv は実行意味論を持たない
- runtime 依存点は submit / observe / unobserve のみ
- ObservedPlan は view（編集不可）

拡張は v1.1 以降で行う。

---

# Appendices

## Appendix A: PropBridge Model（Informative）

本 Appendix は blooky-fv の binding 実装モデルを説明する。規範ではない。

### A.1 PropBridge の役割

PropBridge は `Prop<A>` と DOM の具体的な反映点（node range / attribute / style / dataset 等）を結ぶ **投影アダプタ**である。

PropBridge は次を満たす設計として推奨される：

- **局所性**：ひとつの PropBridge は 1 つの DOM 反映点のみを担当する
- **疎結合**：PropBridge は runtime の commit 意味論を知らず、通知された `ObservedPlan` の値を DOM に反映するだけ
- **寿命管理**：DOM から外れた反映点は `isConnected()` で検出され GC 対象となる

### A.2 Bridge のカテゴリ

実装上は以下のカテゴリが典型である：

- **RangePropBridge**：`Prop<JSHTMLNodeSource>` を DOM Range 置換として反映する
- **AttrPropBridge**：一般属性（href/value/onclick 等）を反映する
- **StylePropBridge / DatasetPropBridge**：`style` / `dataset` の下位要素を反映する

### A.3 contains による包含 GC

Range 置換が行われる場合、旧 DOM を含む範囲が丸ごと置換されることがある。
このとき、同一 DOM 範囲に属する子 Bridge（style/dataset 等）が残留すると購読や参照が漏れるため、`contains()` による包含判定で子 Bridge を除去する戦略が有効である。

---

## Appendix B: `blooky-commit-*` DOM Events（Informative）

本 Appendix は、runtime.submit の結果を DOM に投影する慣習的イベントを説明する。規範ではない。

### B.1 Event List

`listenerForSubmit` 等の adapter は、次の CustomEvent を dispatch してよい（MAY）。

- `blooky-commit-start`（cancelable）
- `blooky-commit-cancelled`
- `blooky-commit-completed`
- `blooky-commit-failed`

### B.2 Payload Contract（Recommended）

各イベントの `detail` は以下の情報を含んでよい（MAY）。

- `plan: DripPlan`（または ObservedPlan と同型の配列）
- `resolved?: unknown`（completed のみ）
- `rejected?: unknown`（failed のみ）

### B.3 Cancellation（Recommended）

`blooky-commit-start` は `cancelable: true` で dispatch されてよい。
`preventDefault()` された場合、adapter は `runtime.submit` を呼び出さないことが慣習的に求められる（Recommended）。

---

**END OF SPECIFICATION**