# blooky-fx Bridge Specification v1.0.0

**Subtitle:** Execution ↔ FRP Bridge, Clock & Atomic Commit Model
**Status:** Draft (Pre-release, Breaking changes allowed until freeze)

---

## 0. Purpose and Scope

本仕様は、**Execution（実行）** と **FRP（データフロー）** の間を接続する
**最小かつ決定的な接着剤（bridge）** を定義する。

本仕様が規定するのは、以下のみである。

1. Execution が生成した **効果（Prop 更新）** を
   **どの単位・どの規則で FRP に適用するか**
2. その適用を駆動・同期させる
   **Clock / Tick / Observer / Atomic Commit** の契約
3. Execution と FRP が値を共有・参照するための
   **FxRef / AppContext / resolveValue** の正規化規則

本仕様は以下を **明示的に対象外**とする。

* FRP コアの演算仕様（map / merge / lift 等）
* FxNote / Score / Semantics / Runner の意味論
* DevTools / UI / DOM 投影モデル

---

## 1. Fundamental Model

### 1.1 Tick

**Tick** とは、

> *複数の Prop 更新が「同時に確定した」とみなされる、最小の時間単位*

である。

* Tick は **Atomic Commit の境界**である
* Tick 内の更新は、外部から逐次的に観測されてはならない

---

### 1.2 Clock

**Clock** は Tick を生成する時間源である。

* Clock は Tick ごとに **単調増加する値**（例: 時刻）を提供してよい
* Clock は UI / Execution / Observation を
  **同一 Tick に整列させる唯一の基準**である

Clock の実装方式（RAF / timeout / virtual time 等）は、本仕様では規定しない。

---

### 1.3 Effect Map

**Effect Map** は、Tick 内で確定される Prop 更新の集合である。

概念的には以下と等価である：

```
Map<Prop<any>, any>
```

* Effect Map は **値の集合**であり、実行命令ではない
* 内部構造・列挙順序・保持形式は意味を持たない

---

## 2. Atomic Commit Rules

### 2.1 Atomicity

同一 Tick 内のすべての Prop 更新は、
**同時に適用されたとみなされなければならない（MUST）**。

* 中間状態を観測可能にしてはならない
* Tick は「部分適用」を持たない

---

### 2.2 Order Independence

Effect Map に含まれる更新は、

* 格納順序
* 列挙順序
* 内部実装順序

に **依存してはならない（MUST NOT）**。

同一 Tick の結果は、順序に関係なく常に一致しなければならない（MUST）。

---

### 2.3 Deduplication (Optional)

Prop の更新結果が **既存値と同一**である場合、

* 実装はその更新を省略してよい（MAY）
* 省略は意味論に影響してはならない

---

## 3. Conflict Prohibition

### 3.1 Conflict Definition

**Conflict** とは、同一 Tick 内において、

* 同一の Prop に対し
* 異なる値が同時に適用される

状況を指す。

---

### 3.2 Conflict MUST NOT Occur

同一 Tick 内における Prop 更新の Conflict は
**仕様違反であり、発生してはならない（MUST NOT）**。

> blooky において、
> **値の競合は「データフロー設計の誤り」であり、
> 実行時に解決すべき問題ではない。**

* 分岐・統合・条件選択は **FRP 側の構造**で表現されるべきである
* Execution / Bridge 層は、競合解決戦略を提供しない

---

## 4. Tick Reservation and Merge

### 4.1 Reservation

Execution は、Tick の確定前に
複数の効果（effect）を **予約（reservation）**してよい。

* Tick は予約されたすべての effect を収集する
* 収集結果は **単一の Atomic Commit** として扱われる

---

### 4.2 Merge Rule

複数の effect が存在する場合、最終的な Effect Map は：

* Prop ごとに **一意な更新**のみを含む
* Conflict を含んではならない（MUST NOT）

---

## 5. Observer Contract

### 5.1 Observer Role

**Observer** は Tick における Effect Map を受け取り、

* UI 更新
* DevTools 通知
* 外部システムへの投影

を行う。

Observer は **観測者であり、意味論を追加しない**。

---

### 5.2 Atomic Observation

Observer は、Tick を **Atomic Commit** として扱わなければならない（MUST）。

* Tick 内の部分更新を逐次処理してはならない
* 観測結果は「確定後の状態」のみを表す

---

### 5.3 Observer Failure Policy (Strict)

本仕様では、**Strict Policy を採用する**。

* Observer 内で例外（throw）が発生した場合
  **Tick 全体は失敗とみなされる（MUST）**
* 当該 Tick に予約されたすべての処理は reject される

> 観測は特権であり、
> 観測の失敗は「無視可能な副作用」ではない。

---

## 6. Execution ↔ FRP Bridge

### 6.1 AppContext

**AppContext** は、Execution と FRP が共有する辞書である。

* 任意のキー（string / symbol）を持ちうる
* 値は即値・Prop のいずれも取りうる

AppContext の保護・委譲・Proxy 化は実装に委ねる。

---

### 6.2 FxRef

**FxRef<T>** は、以下のいずれかである。

* AppContext のキー参照
* `Prop<T>`
* 即値 `T`

FxRef は **記述上の利便性のための型**であり、
Execution の意味論を変更しない。

---

### 6.3 resolveValue

`resolveValue(ref, appContext)` は、FxRef を `Prop<T>` に正規化する操作である。

#### 規則：

1. `Prop<T>` → そのまま返す（MUST） 
2. 即値 `T` → `() => T` にラップして返す（MUST）
3. AppContext 参照 → 値取得後、上記規則で正規化（MUST）

---

### 6.4 Resolve Stability

`resolveValue` は **参照解決のみ**を行う。

* 実行順序
* 中断 / 再開
* タイミング

には一切関与しない（MUST NOT）。

---

## 7. Design Consequences (Normative)

本仕様により、以下が保証される。

* Execution / UI / DevTools は **同一 Tick に同期**する
* Prop 更新は **常に原子的に観測**される
* 競合は設計段階で排除され、実行時に曖昧さを残さない
* Bridge 層は **薄く・決定的**であり、意味論を持たない

---


## 8. Frozen Declaration (候補)

🔒 **Frozen (upon release)**

* 本仕様は v1.0.0 公開後、後方互換を破る変更を行わない
* 拡張は appendix または v1.1 以降で行う
* Conflict MUST NOT / Strict Observer Policy は不変とする


---
## Appendix A: Core Type Definitions（Normative）

### A.1 ExecutionPhase

```ts
export type ExecutionPhase =
  | "enter"
  | "active"
  | "suspend"
  | "resume"
  | "exit"
  | "cancel";
```

### A.2 CancelReason / CancelToken

```ts
export type CancelReason =
  | "user"
  | "return"
  | "timeout"
  | "error";

export type CancelToken = {
  parent?: CancelToken;
  cancel: (reason?: CancelReason) => void;
  cancelled: () => boolean;
  reason?: CancelReason;
};
```

### A.3 ExecutionStep

```ts
export type ExecutionStep =
  | {
      phase: "exit";
      node: FxNote;
      data?: unknown;
      effect?: DripEffect<any>;
    }
  | {
      phase: "suspend";
      node: FxNote;
      data: { until: Prop<boolean> };
    }
  | {
      phase: "cancel";
      node: FxNote;
      data?: any;
    }
  | {
      phase: "enter" | "active" | "resume";
      node: FxNote;
      data?: unknown;
    };
```

### A.4 FxRef / AppContext / ExecContext

```ts
export type FxRef<T> =
  | { key: string } // [FxRefSymbol]: true
  | Prop<T>
  | T;

export type AppContext = Record<string | symbol, unknown>;

export interface ExecContext {
  executionId: string;
  cancelToken: CancelToken;
  resolve<T>(ref: FxRef<T>): Prop<T>;
}
```

---

## Appendix B: 仕様の対象外とする事項（Non-goals / Out of Scope）

本 Appendix は、blooky-fx v3.0.0 が **意図的に仕様の対象外とする領域**を列挙する。
ここに挙げる項目は、将来の追加を否定しないが、**v3.0.0 の責務として定義しない**。

> 注記：本 Appendix は「削除」ではない。
> v2.x で仕様化されていない事項を **誤って仕様の一部と解釈されることを防ぐための境界宣言**である。

---

### B.1 FRP コア意味論は対象外

blooky-fx v3.0.0 は、以下の FRP コア意味論を定義しない：

* Stream / Prop の計算モデル
* map / merge / lift 等の演算規則・同値性
* 再計算粒度や差分計算の方式
* ガベージコレクションや参照解放の規則

これらは **blooky-fp**（または同等の FRP 層）の責務である。

---

### B.2 Promise / 非同期計算モデルは対象外

blooky-fx v3.0.0 は、以下を定義しない：

* Promise の解決を FRP に統合するための規則
* async stream / awaitable stream といった別系列の時間モデル
* Promise を「待つ」ことによる自動再駆動

blooky-fx が扱う時間は **Tick**（Scheduling Unit）であり、
Promise は **値として流れる**か、または上位層（Semantics / Node 実装 / Userland）が取り扱う。

---

### B.3 Effect の戦略的スケジューリングは対象外

blooky-fx v3.0.0 は、Effect の発火戦略（debounce / throttle / lock / queue 等）を仕様化しない。
v3.0.0 が定義するのは、**同一 Tick における適用境界**（atomic commit の単位）である。

---

### B.4 実行介入（Middleware）は対象外

blooky-fx v3.0.0 は、ExecutionStep を横断的に改変する Middleware 機構を必須要素として持たない。
観測は Observer で行うが、Observer は実行の意味・結果を変更してはならない。

---

### B.5 UI / Projection / DevTools の意味論は対象外

blooky-fx v3.0.0 は以下を定義しない：

* DOM とのバインディング規則
* Snapshot / Projection の構造
* DevTools の表示モデル

これらは上位層（例：fv / devtools）の責務である。

---

## Appendix C: v3.0.0 における挙動固定（Normative Clarifications）

本 Appendix は、実装が従来から採用していた挙動のうち、**v3.0.0 において仕様として固定した事項**を列挙する。

---

### C.1 Observer Failure Policy（Strict）

Observer 内で例外が発生した場合、Tick は失敗として扱う。
この方針は **Strict** に固定される。

* 例外は握り潰されない
* 失敗は呼び出し元に伝播する
* Tick の成功として扱って継続しない

---

### C.2 同一 Tick 内の競合（Conflict）禁止

同一 Tick 内において、同一 Prop に対し **異なる値**を適用することは **MUST NOT**。
blooky-fx は競合解決規則を提供しない。

この制約は、blooky が意図する「データフロー側で分岐・統合を表現する」規律を前提とする。
