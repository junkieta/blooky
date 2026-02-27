# blooky-context Specification v1.0.0

**Status:** 🔒 Final / Frozen
**Scope:** Context Boundary, Context Reference Model, Context Reference Codec
**Applies to:** fv.prime / fxdom / fx runtime / devtools / remote transports

---

# 0. Purpose

本仕様は、blooky における **Context の境界契約**および
**Context に束縛された参照（ContextRef）の規範**を定義する。

本仕様は以下を規定する：

1. Context の境界的意味
2. Context の同一性・スコープ・構造的不変性
3. ContextKey の型域
4. ContextRef / Literal / ContextValue の型と意味
5. ContextRef の符号化／復号（Codec）
6. 参照決定性および失敗規則
7. 属性レベル制約
8. ドメイン拡張参照との関係
9. Wire 正規形（remote transport 対応）

---

# 1. Context Boundary Contract（Normative）

## 1.1 Context as Boundary

Context は、prime によって生成されるコンポーネントと外界との境界契約である。

Context は以下を定める：

* 外部依存の定義
* 外部結合点の定義
* 参照可能値の名前空間（ContextKey 空間）

Context はデータの入れ物ではなく、結合の定義である。

---

## 1.2 Lifetime & Structural Immutability（Normative）

* Context の構造（ContextKey の集合および key→value 束縛関係）は prime 実行後に変更してはならない（MUST NOT）。

* 同一 ContextKey に対して異なる値を再束縛してはならない（MUST NOT）。

* Context に束縛された値が可変オブジェクトであることは許される（MAY）。

* 実装は、契約違反を早期に発見するため、構造変更の試行を検出し失敗させることが望ましい（SHOULD）。

---

## 1.3 Prime との整合（Normative）

* 各 prime 呼び出しは、当該コンポーネント境界に対応する Context インスタンスを持たなければならない（MUST）。
* 呼び出し側が `ctx` を prime に提供する場合、prime はそれを当該呼び出しの Context インスタンスとして扱わなければならない（MUST）。
* 本仕様は prime による Context インスタンスの新規生成を要求しない。

（これにより凍結済み blooky-fv v1.0.0 と整合する。）

---

## 1.4 ContextKey（Normative）

```ts
type ContextKey = string
```

* ContextKey は同一スコープ内で一意でなければならない（MUST）。
* 親子スコープ間で同一 key が存在する場合の解決規則は §1.5 に従う（MUST）。

---

## 1.5 Scope & Resolution（Normative）

### 1.5.1 decode の探索規則

* decode は現在の Context から親 Context へ向かう探索順序に従わなければならない（MUST）。
* 同一 key が複数スコープに存在する場合、より内側（子）が優先される（MUST）。

### 1.5.2 非対称性（Normative Clarification）

* decode はスコープチェーンを探索するが、encode は探索しない。
* encode/decode の往復可能性は保証されない（MUST NOT assume）。

---

# 2. Context Reference Model（Normative）

## 2.1 ContextRef

```ts
type ContextRef = {
  kind: "ctx",
  key: ContextKey
}
```

---

## 2.2 Literal

```ts
type Literal = {
  kind: "literal",
  value: unknown
}
```

---

## 2.3 ContextValue

```ts
type ContextValue = ContextRef | Literal
```

---

## 2.4 LiteralPrimitive（Normative）

```ts
type LiteralPrimitive = undefined | null | boolean | number | bigint | string
```

---

# 3. Context Reference Codec（Normative）

## 3.1 Interface

```ts
type Context = unknown // 本仕様は Context の内部表現を規定しない

bind(ctx: Context, key: ContextKey, value: unknown): void
encode(ctx: Context, value: unknown): ContextValue
decode(ctx: Context, ref: ContextRef): unknown
```

---

## 3.2 bind（Normative）

* bind は key→value を登録する（MUST）。
* 同一 key に異なる値を登録してはならない（MUST NOT）。
* 同一 value の多重束縛は推奨されない（SHOULD NOT）。
* 多重束縛を行う場合、選択規則は決定的でなければならない（MUST）。

---

## 3.3 encode（Normative）

* encode は ContextValue を返さなければならない（MUST）。

* value が LiteralPrimitive である場合、Literal を返す（MUST）。

* value が symbol または非プリミティブ参照値である場合：

  * 当該 Context に bind 済みなら ContextRef（MUST）
  * 未bindなら失敗（MUST）

* encode は当該 Context インスタンスに束縛された値のみを参照化しなければならない（MUST）。

* encode は親子スコープを跨いで参照化してはならない（MUST NOT）。

---

## 3.4 decode（Normative）

* decode は ContextRef.key に対応する値を返す（MUST）。
* decode は §1.5.1 の探索規則に従う（MUST）。
* 未登録 key は失敗しなければならない（MUST）。
* decode 失敗を黙殺または暗黙フォールバックしてはならない（MUST NOT）。

---

## 3.5 Error Categories（Normative）

本仕様における失敗は、識別可能な **エラーカテゴリコード**で分類されなければならない（MUST）。

| Code               | 発生箇所 | 発生条件                        |
| ------------------ | ---- | --------------------------- |
| ENCODE_UNBOUND     | §3.3 | 未bind非プリミティブまたは未bind symbol |
| DECODE_MISSING_KEY | §3.4 | 未登録 key                     |
| VALUE_CONSTRAINT   | §4   | 属性が要求する ContextValue 形に違反   |

* エラーは識別可能なカテゴリコードを持たなければならない（MUST）。
* decode 失敗を暗黙的に無視してはならない（MUST NOT）。

---

# 4. Attribute-Level Constraints（Normative）

* 本仕様は属性の意味論を定義しない。
* 各ドメイン仕様は、属性が受理する ContextValue の形（ContextRef のみ、Literal のみ、または両方）を定義しなければならない（MUST）。
* 属性が ContextRef のみを受理する場合、Literal が与えられた時点で失敗しなければならない（MUST）。
* 属性制約違反は `VALUE_CONSTRAINT` カテゴリとして報告されなければならない（MUST）。

---

# 5. Domain Reference Extensions（Normative / Optional）

ドメインは ContextRef を拡張してよい（MAY）。
拡張は決定性を破ってはならない（MUST NOT）。

---

# Appendix A. Wire Representation（Normative）

remote transport を行う実装は、本 Appendix に定義される ContextValueWire を使用しなければならない（MUST）。

## A.1 Wire 型定義（Normative）

```ts
type ContextKeyWire =
  | { kind: "string", value: string }
  | { kind: "symbol", value: string } // global symbol only: Symbol.keyFor(symbol)

type ContextRefWire = {
  kind: "ctx",
  key: ContextKeyWire
}

type NumberWire =
  | { kind: "number", value: number, negativeZero?: true }
  | { kind: "nan" }
  | { kind: "posinf" }
  | { kind: "neginf" }

type LiteralValueWire =
  | { kind: "null" }
  | { kind: "boolean", value: boolean }
  | { kind: "string", value: string }
  | NumberWire
  | { kind: "bigint", value: string }      // base10
  | { kind: "undefined" }                  // JSON前提の場合は使用禁止（A.3参照）

type LiteralWire = {
  kind: "literal",
  value: LiteralValueWire
}

type ContextValueWire = {
  version: "1",
  payload: ContextRefWire | LiteralWire
}
```

---

## A.2 数値特例（Normative）

* NaN, +Infinity, -Infinity は `NumberWire` の `nan/posinf/neginf` で表現しなければならない（MUST）。
* -0 は `negativeZero:true` により区別しなければならない（MUST）。

---

## A.3 JSON 前提（Normative）

* JSON transport を用いる場合、`{ kind:"undefined" }` を送信してはならない（MUST NOT）。

  * JSON を用いる場合、未定義値はドメイン側で表現を決める（例：null に正規化する、または送信しない等）。

---

## A.4 bigint（Normative）

* bigint は base10 の文字列として表現しなければならない（MUST）。

---

# 5. Design Guarantees

* Context は fv v1.0.0 と整合する
* encode/decode の非対称性が明示される
* symbol 利用時の責務が明確
* Wire 互換が担保される
* エラー分類が仕様全体で一覧化される
* 属性制約の責務分離が明確

---
