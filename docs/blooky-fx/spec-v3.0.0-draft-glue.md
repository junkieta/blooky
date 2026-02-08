# blooky-fx Glue Specification

## Version 3.0.0 — Draft

**Status:** Draft
**Audience:** blooky-fx / score-fx / blooky-fp 実装者および設計者
**Language:** Japanese (Normative)

---

## 1. Overview

本仕様は、**Execution（FxNote の実行）**と **FRP（Stream / Prop）** を接合するための
**最小かつ規範的な「接着剤仕様（Glue Specification）」**である。

blooky-fx v3 系は、以下の原則に基づき設計される。

* 実行の意味論（Semantics）と時間制御（Scheduling）を分離する
* 副作用は **exit フェーズでのみ** FRP に束縛される
* 時間は **tick** によって一元管理される
* 同一 tick 内の変更は **atomic commit** として扱われる
* 実装の自由度を残しつつ、「悪いコード」を構造的に排除する

本仕様は **フレームワークの振る舞いを限定するためのものではない**。
むしろ、「実装が踏み越えてはならない境界」を明示することを目的とする。

---

## 2. Scope and Non-Goals

### 2.1 In Scope

本仕様が定義するのは、以下に限られる。

* ExecutionStep とその phase モデル
* tick / clock / observer による時間制御の責務境界
* Execution ↔ FRP 間の値・効果の橋渡し規則
* 同一 tick 内における atomic commit と競合規則

### 2.2 Out of Scope（概要）

以下は **明示的に本仕様の範囲外**である。

* FxNote の意味論（kind / vocabulary）
* UI / DOM / Snapshot / DevTools 表示モデル
* Timeline の内部表現
* async stream / Promise 解決モデル

詳細は Appendix B を参照。

---

## 3. Terminology

| 用語            | 定義                         |
| ------------- | -------------------------- |
| Execution     | FxNote による処理の進行            |
| ExecutionStep | 実行中に観測される最小単位              |
| FRP           | Stream / Prop による時変データフロー  |
| Effect        | FRP への変更設計図（DripEffect）    |
| tick          | 時間を進め、Effect を適用する操作       |
| Atomic Commit | 同一 tick 内の変更を同時に適用したとみなす規則 |
| Observer      | tick 中に Effect を観測する外部関数   |

---

## 4. Execution Model

### 4.1 ExecutionPhase

Execution は、以下の phase を持つ Step を生成する。

* `enter`
* `active`
* `suspend`
* `resume`
* `exit`
* `cancel`

phase の定義は Appendix A を参照。

### 4.2 ExecutionStep

ExecutionStep は **事実（fact）**であり、命令ではない。

* Step は生成順に観測される
* Step は実行を制御しない
* Step は再生・記録・可視化の対象となり得る

---

## 5. Scheduling Model（Clock / Tick）

### 5.1 Tick as Sole Time Authority

`tick` は、Execution と FRP に共通する **唯一の時間進行点**である。

* Execution は tick を直接進めてはならない（MUST NOT）
* FRP の collapse は tick を通じてのみ発生する（MUST）

### 5.2 Observer

tick は Observer を呼び出すことができる。

* Observer は Effect の部分集合を観測できる
* Observer は副作用（DOM 更新等）を行ってよい（MAY）

### 5.3 Observer Failure Policy（Strict）

Observer が例外を投げた場合、tick は失敗とみなされる（MUST）。

* 失敗は呼び出し元に通知されなければならない（MUST）
* 観測失敗を黙殺する寛容動作は提供しない（MUST NOT）

---

## 6. Execution ↔ FRP Bridge

### 6.1 AppContext

`AppContext` は Execution と FRP が共有する値空間である。

* 意味論を持たない（MUST）
* 値・Prop・参照の解決にのみ使用される

### 6.2 FxRef Normalization

`FxRef<T>` は以下のいずれかである。

* 即値 `T`
* `Prop<T>`
* AppContext 参照オブジェクト

`resolve(ref)` は必ず `Prop<T>` を返す（MUST）。

### 6.3 Exit-only Effect Binding

* `ExecutionStep.effect` を持てるのは `exit` フェーズのみ（MUST NOT）
* `cancel` フェーズは effect を持たない（MUST NOT）
* Node 実装が `collapse` を直接呼んではならない（MUST NOT）

### 6.4 Atomic Commit

同一 tick 内の Effect は **同時に適用されたものとして扱う**（MUST）。

* 適用順序に依存してはならない（MUST NOT）
* 中間状態を観測してはならない（MUST NOT）

### 6.5 Conflict Rule（競合禁止）

同一 tick 内に、同一 Prop に異なる値を適用してはならない（MUST NOT）。

* 合成は FRP 側で明示的に定義する（MUST）
* これは「良いコードへ矯正する」設計原則である

---

## Appendix A: Core Type Definitions（Normative）

（※ ここは **そのまま貼り付け可能**）

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
  | { key: string }
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

## Appendix B: Out of Scope（規範）

### B.1 UI / DOM Projection

### B.2 Execution Semantics

### B.3 Timeline Internal Representation

### B.4 Promise Resolution / Async Stream

これらは本仕様で定義しない。

---

## Appendix C: Normative Cross-References

* 本仕様 → **score-fx**（ExecutionStep / phase 整合）
* 本仕様 → **blooky-fp**（Stream / Prop / DripEffect 整合）

参照は **こちらから張る**ことを正とする。

---

## Closing Note

blooky-fx v3.0.0 は「削る」ためのバージョンではない。
**責務を正しい場所に戻すためのバージョン**である。

Execution は演奏し、
FRP は流れ、
tick は時間を与える。

それ以上のことを、誰も勝手にやってはならない。

