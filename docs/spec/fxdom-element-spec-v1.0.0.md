# fxdom Element Specification v1.0.0

**Status:** 🔒 Final / Frozen
**Scope:** DOM-based Score Description (fxdom → FxScore)
**Depends on (Normative):** score-fx Protocol Specification v1.0.0
**Related:** blooky-bridge v1.0.0 (out of scope), DevTools Projection (out of scope)

---

## 0. Purpose and Scope

fxdom は、**DOM 構造（要素と入れ子）によって score-fx の Score（FxScore）を記述するための要素語彙**である。

fxdom は：

* 実行エンジンではない
* DSL の意味実装ではない
* 実行順序・スケジューリング・待機解決・副作用適用を規定しない

fxdom が規定するのは：

1. **score-fx 構造語彙に対応する DOM 要素語彙**
2. それぞれの要素が生成する **FxNote の構造（Score の形）**
3. 最小限の **参照構文**（特に `<fx-yield for="…">` の locator）

fxdom が明示的に対象外とするもの：

* Runner の実行意味論（進行規則の実装詳細）
* Bridge/FRP への適用方式（tick/commit/atomicity 等）
* Snapshot / Projection / DevTools 表示モデル
* DOM event の起動制御（ignite 等）

---

## 1. Normative Dependencies and Terminology

### 1.1 Normative dependency

fxdom は score-fx v1.0.0 に準拠しなければならない（MUST）。
fxdom は score-fx の構造語彙（sequence/parallel/race/loop/condition/switch 等）を再定義してはならない（MUST NOT）。

### 1.2 Terminology

* **FxNote / FxScore**: score-fx の定義に従う
* **Effect Element**: fxdom の要素で、FxNote を生成する宣言ノード
* **Template（HTMLTemplateElement）**: fxdom における **Score 定義のコンテナ**（実行されない定義）
* **Yield**: Template（または remote locator）が示す Score を実行境界として委譲するノード（score-fx: yield note）

---

## 2. Core Principles

### 2.1 One-way declaration

fxdom の要素は **一方向にのみ** FxNote（Score）を生成する。

* 実行結果が DOM 構造を変更することはない（MUST NOT）
* 実行の進行は別層（Observer/Projection）により反映されうるが、fxdom 自体の責務ではない

### 2.2 Score vocabulary is primary

HTML/Document/iframe などの語彙は **メンタルモデルの説明用**であり、fxdom の規範語彙は score-fx を主とする。

### 2.3 Output binding is opaque

`done` は「値の外部接続口（output port）」を示すが、**配送先が FRP/イベント/その他であるか**を fxdom は規定しない（MUST NOT）。

---

## 3. Common Definitions

### 3.1 Effect Element

fxdom の各要素は **FxNote を生成する宣言的ノード**である。

* 要素は FxNote を生成してよい（MAY）
* FxNote 以外の意味（実行・適用・描画）を直接持ってはならない（MUST NOT）

### 3.2 Content model notation

本文中の内容モデルは HTML 仕様風に簡略表記する。

* `(effect element)+` : 1個以上の effect element
* `(effect element)*` : 0個以上
* `empty` : 子を持たない（ただしテキストノード等の扱いは別途）

### 3.3 Reference tokens

fxdom は参照値の全体系を規定しない。
ただし `<fx-yield for="…">` に関しては **locator 構文**を最小限規定する（§6）。

他の属性値（`action`, `by`, `until`, `ms`, `value`, `input`, `done` など）の解決は **実装（Profile/Host）**に委ねる。

**Profile Slot note（Normative）**:
fxdom における Profile/Host は、参照解決のための実装差し替え点である。
fxdom が要求するのは解決関数が存在し呼び出せることであり、
Profile/Host 自体の closed set や独立 conformance は規定しない。

---

## 4. Element Vocabulary

本章は各要素を **HTML 要素仕様に近い粒度**で定義する。ただし **実行アルゴリズム**は定義しない。

---

# 4.1 Structural Elements

## 4.1.1 `<fx-sequence>`

### Summary

子要素を「順序を持つ subnote 列」として提示する。

### Content model

```text
<fx-sequence>
  (effect element)+
</fx-sequence>
```

### Attributes

なし。

### DOM constraints

* 子要素は effect element でなければならない（MUST）
* テキストノード等は無視してよい（MAY）

### Declarative semantics

* 子は **記述順**を持つ
* その順序に基づく進行規則は score-fx の `sequence` に従う（Normative by dependency）

---

## 4.1.2 `<fx-parallel>`

### Summary

子要素を「並行関係にある subnote 集合」として提示する。

### Content model

```text
<fx-parallel>
  (effect element)+
</fx-parallel>
```

### Attributes

なし。

### DOM constraints

* 子要素は effect element でなければならない（MUST）

### Declarative semantics

* 子は互いに独立な subnote として提示される
* 進行規則は score-fx の `parallel` に従う

---

## 4.1.3 `<fx-race>`

### Summary

子要素を「競合（race）関係にある subnote 集合」として提示する。

### Content model

```text
<fx-race>
  (effect element)+
</fx-race>
```

### Attributes

なし。

### DOM constraints

* 子要素は effect element でなければならない（MUST）

### Declarative semantics

* 子は競合関係として提示される
* 進行規則は score-fx の `race` に従う

---

# 4.2 Boundary / Waiting Elements

## 4.2.1 `<fx-wait>`

### Summary

外部条件が満たされるまで進行が停止しうる境界を提示する。

### Content model

```text
<fx-wait />
```

### Attributes

* `until`（optional）: 条件参照（opaque）
* `ms`（optional）: 時間参照（opaque）

### DOM constraints

* 子要素を持ってはならない（MUST NOT）

### Declarative semantics

* 「待機点が存在する」ことのみを宣言する
* 条件の評価・購読・判定方法は fxdom では定義しない（MUST NOT）

---

# 4.3 Execution Elements

## 4.3.1 `<fx-call>`

### Summary

関数呼び出し（外界との接点）という作用単位を提示する。

### Content model

```text
<fx-call />
```

### Attributes

* `action`（required）: 呼び出す関数参照（opaque）
* `input`（optional）: 入力値参照（opaque）
* `done`（optional）: 出力接続口（opaque）

> 注：`input` は **単一入力**のための最小語彙として提供される。複数引数や構造化は Profile 側の解決規約に委ねる。

### DOM constraints

* 子要素を持ってはならない（MUST NOT）

### Declarative semantics

* 呼び出しの発生を宣言する
* `done` は出力値の接続口を示すのみであり、配送方式を規定しない（MUST NOT）

---

## 4.3.2 `<fx-yield>`

### Summary

`<fx-yield>` 要素は、**進行主権を別の Flow 境界へ委譲する地点**を表す宣言的ノードである。

`<fx-yield>` は、

* 指定された locator により Flow を参照し、
* その実行へ制御を委譲し、
* 必要に応じて戻り値を外部へ接続する

という**構造的境界**を宣言する。

fxdom はその意味論（実行方法・待機方法・再開条件）を定義しない。

---

### Content model

```text
<fx-yield />
```

`<fx-yield>` は子要素を持ってはならない（MUST NOT）。

---

### Attributes

* `for`（必須）
  Flow locator。
  解決方法・実行方法は fxdom では規定しない。

* `input`（任意）
  子 Flow へ渡される入力値。
  解決方法は fxdom では規定しない。

* `done`（任意）
  子 Flow の終了時に得られた値を外部へ接続するための識別子。
  接続方式（FRP / event / callback 等）は fxdom の責務ではない。

---

### DOM constraints

* `for` 属性は必須である（MUST）
* 子要素を持ってはならない（MUST NOT）
* `input` と `done` は同時に指定してよい（MAY）

---

### Declarative semantics

`<fx-yield>` は以下のみを宣言する：

1. 指定された Flow へ進行を委譲する地点であること
2. 必要に応じて入力値を渡すこと
3. 終了時の値を外部へ接続する窓口を持ちうること

以下は fxdom の責務ではない（MUST NOT）：

* locator の解決方式
* ローカル／リモートの区別
* 再開タイミング
* 戻り値の型
* 接続先の技術的実装

---

# 4.4 Conditional / Selection Elements

## 4.4.1 `<fx-switch>`

### Summary

選択値 `by` に基づいて 1 つの subnote を選択する構造を提示する。

### Content model

```text
<fx-switch by="...">
  (effect element)*
</fx-switch>
```

### Attributes

* `by`（required）: 選択参照（opaque）

### Child addressing (slots)

`slot`（HTML 標準属性）を用いて分岐先を指定する。

* `slot="default"` : 既定分岐
* その他の `slot="<token>"` : ケースラベル（token の集合）

**Normative clarification（非要求）**：

* fxdom は `slot` の **Shadow DOM 割り当て機構**（slotting）の存在を **要求しない**（MUST NOT require）。
  すなわち、ShadowRoot や actual slot assignment を伴わない文書でも、`slot` はケースラベルとして解釈されうる。
* ただし、`slot` を採用した意図（「ラベル割当」というメンタルモデル）を否定しない。
  本仕様が規範化するのは **“要求しない”** という点のみである。

### DOM constraints

* `by` は必須（MUST）
* 子は effect element でなければならない（MUST）
* `slot` がない子要素が存在する場合の扱いは実装が定義してよい（MAY）。ただし **推奨は `default` 扱い**（SHOULD）。

### Declarative semantics

* `by` の解決・同値性・型（文字列/数値/シンボル等）を fxdom は規定しない（MUST NOT）
* `slot` の選択規則（どの token と一致するか）は実装（Profile/Host）に委ねる（MUST）

> **設計意図**：fxdom は「switch という構造」と「ケースの宣言」を提供するが、`by` の解決と一致判定を抱えない。

---

## 4.4.2 `<fx-if>`

### Summary

`<fx-if>` 要素は、**条件に基づく二分岐構造**を表す宣言的ノードである。

`<fx-if>` は `<fx-switch>` によって表現可能な構造の特化形であるが、
可読性および構造的明示性のために独立要素として定義される。

---

### Attributes

* `test`（必須）
  条件参照。
  評価方法・型・同値性・解決規則は fxdom では規定しない。

---

### Content model

```text
<fx-if>
  (fxdom effect element)*
</fx-if>
```

子要素は fxdom effect element でなければならない（MUST）。

---

### slot 規則（Normative）

`<fx-if>` の子要素は、以下の `slot` 値のみを持つことができる：

* 未指定
* `"then"`
* `"else"`

それ以外の `slot` 値は不適合である（MUST NOT）。

---

### 分岐モード

`<fx-if>` には 2 つの構文モードが存在する。

---

#### A. then-only モード（簡略記法）

条件：

* 子要素に `slot="else"` が存在しない場合。

規則：

* `slot` 未指定の子要素はすべて `"then"` として扱われる（MUST）。
* `slot="then"` を明示的に記述してもよい（MAY）。
* `slot="else"` は存在してはならない（MUST NOT）。

このモードは簡潔な記述を目的とする。

例：

```html
<fx-if test="$isOk">
  <fx-call action="log" input="OK branch" />
</fx-if>
```

---

#### B. else-present モード（明示記法）

条件：

* `slot="else"` を持つ子要素が 1 つでも存在する場合。

規則：

1. `slot="then"` を持つ子要素が 1 つ以上存在しなければならない（MUST）。
2. `slot="else"` は高々 1 つでなければならない（0..1）（MUST NOT exceed 1）。
3. `slot` 未指定の子要素を含んではならない（MUST NOT）。

例（適合）：

```html
<fx-if test="$isOk">
  <fx-call slot="then" action="log" input="OK branch" />
  <fx-call slot="else" action="log" input="NG branch" />
</fx-if>
```

例（不適合）：

```html
<fx-if test="$isOk">
  <fx-call action="log" input="OK branch" />
  <fx-call slot="else" action="log" input="NG branch" />
</fx-if>
```

上記は、`else` が存在するにもかかわらず `then` が明示されていないため不適合である。

---

### Declarative semantics

`<fx-if>` は以下のみを宣言する：

* 条件に基づき、then 分岐または else 分岐が提示されること

以下は fxdom の責務ではない（MUST NOT）：

* 条件評価の方式
* 真偽値の型定義
* 分岐の実行順序
* 短絡評価の有無

`<fx-if>` は制御命令ではなく、**構造宣言**である。

---

# 4.5 Repetition Elements

## 4.5.1 `<fx-loop>`

### Summary

反復構造を提示する。

### Content model

```text
<fx-loop while="...">
  (effect element)+
</fx-loop>
```

### Attributes

* `while`（required）: 継続条件参照（opaque）

### DOM constraints

* `while` は必須（MUST）
* 子は 1 個以上（MUST）

### Declarative semantics

* 継続条件の評価方法は fxdom では規定しない（MUST NOT）
* 進行規則は score-fx の `loop` に従う（依存により規範化）

---

# 4.6 Termination Element

## 4.6.1 `<fx-return>`

### Summary

現在の委譲境界（yield により生成される実行境界）を終了し、値を返す終端を提示する。

### Content model

```text
<fx-return />
```

### Attributes

* `input`（optional）: 返却値参照（opaque）

### Flow boundary constraint (Normative)

`<fx-return>` は **Flow 境界（Template により定義され、yield により生成される実行境界）**の内部にのみ存在してよい（MUST）。

より具体的に：

* `<fx-return>` は **HTMLTemplateElement の `content` 由来の subtree**の中に存在しなければならない（MUST）
* `<fx-return>` は **最も近い yield 対象テンプレートの境界**（そのテンプレートに対応する実行境界）を終了させるものとして解釈されなければならない（MUST）

### Prohibitions

* `<fx-return>` は `done` を持ってはならない（MUST NOT）
* `<fx-return>` は出力接続口ではない（MUST NOT treat as output binding）

### Declarative semantics

* return は「境界終了」を宣言する
* 終了の伝播や親側の扱いは fxdom では規定しない（MUST NOT）

---

## 5. Attributes: Minimal Policy

### 5.1 No auxiliary labeling vocabulary

fxdom は `label` / `value(label)` 等の表示補助属性を定義しない。
表示補助が必要な場合、HTML 標準の `title` を用いてよい（MAY）。

> これは「全要素共通語彙」の話であり、個別要素の必須属性（`action`, `by`, `test` 等）を否定しない。

### 5.2 `slot` is used as-is

分岐・選択に必要なラベルは fxdom 独自属性ではなく **HTML 標準属性 `slot`** を用いる。
`slot` のトークン体系自体（文字種など）は fxdom では規定しない（MUST NOT）。

---

## 6. `<fx-yield for="…">` Locator (Remote/Local)

`for` は **委譲先の識別子（locator）**である。fxdom v1.0.0 は最小限の構文のみを規定する。

### 6.1 Locator forms (Normative)

`for` は以下のいずれかでなければならない（MUST）：

1. **Local Template Reference**

   * `#<id>`
   * 同一 Document 内の `id` を持つ `HTMLTemplateElement` を参照する

2. **Remote Locator**

   * `ws:` / `wss:` / `http:` / `https:` で始まる URI

### 6.2 Local template reference rules

* `#<id>` が参照する要素は **HTMLTemplateElement** でなければならない（MUST）
* template 以外を参照してはならない（MUST NOT）
* `#` 以外の CSS selector 構文（例：`.class`, `div > ...`）は fxdom では定義しない（MUST NOT）

### 6.3 Remote locator rules (minimum)

Remote locator の意味（接続方式、認証、フォーマット、変換規約など）は fxdom では規定しない（MUST NOT）。
ただし実装は remote を **Score 取得・実行境界の生成**として扱ってよい（MAY）。

> 実装例：WebSocket 経由で fxdom 互換 JSON/DOM を取得して Score 化する、等。

---

## 7. Identifier and Reference Resolution (Non-normative boundary)

fxdom は「参照の全体系」を規定しない。
ただし設計方針として：

* **ContextRef（キー参照）**の利用を前提としてよい
* `action`, `by`, `test`, `until`, `ms`, `value`, `done` は **opaque な参照**として扱われうる
* それらの解決規約は **Profile/Host** の責務

fxdom は「DOM 外参照禁止」のような一般語彙で ContextRef を否定しない。

### Context Vocabulary Mapping（Normative）

- **AppContext**: 実行時の値辞書（`Record<string | symbol, unknown>` 相当）
- **ContextRef**: fxdom 上のキー参照表現（例: `"$count"`）
- **Resolution**: ContextRef を AppContext に対して解決する処理（Host/Runner の責務）

---

### ContextValue Interpretation（Normative）

fxdom が ContextValue を扱う場合、その解釈は
**blooky-context Specification v1.0.0** に従わなければならない（MUST）。

* ContextRef は decode により解決されなければならない（MUST）。
* Literal は静的値として扱われなければならない（MUST）。

Host または Runner が属性値を encode する場合、
その encode は blooky-context §3.3 に従わなければならない（MUST）。

encode 失敗（ENCODE_UNBOUND）は属性値の適用前に伝播しなければならない（MUST）。

fxdom 自身は親スコープへの encode を試みてはならない（MUST NOT）。

---

## 8. Out of Scope / Non-goals (Normative boundary)

fxdom v1.0.0 は以下を定義しない：

* Runner の進行アルゴリズム
* Profile の resolver（`by` の一致判定、`test` の真偽判定、`done` の配送）
* Bridge/commit/atomic tick
* Snapshot / Projection / DevTools 表示意味論
* DOM イベント（起動・監視）を仕様として強制すること

---

## 9. Conformance (Normative)

fxdom 実装が v1.0.0 に適合するためには、少なくとも次を満たさなければならない（MUST）：

1. **Vocabulary conformance**
   fxdom が生成する Score 構造が score-fx v1.0.0 の構造語彙と矛盾しないこと

2. **Template-based definition**
   Score 定義は `HTMLTemplateElement` を用いて表現可能であること
   （fxdom は flow 要素を必須としない）

3. **Yield locator conformance**
   `<fx-yield for="…">` の `for` は §6 の locator 構文に従うこと

   * `#id` は template のみを参照すること（MUST）
   * remote locator は URI 形式であること（MUST）

4. **HTML id constraints respect**
   fxdom 実装は HTML の `id` 仕様（同一 document 内で一意）を前提とし、これを破る前提の設計を要求してはならない（MUST NOT）。

> 注：template の再利用に伴う `content` 側の `id` 設計は利用者の責務になりうるが、fxdom v1.0.0 はそれを追加規範として過剰に規定しない。

---

## 10. Frozen Declaration（Normative）

🔒 **Frozen**

* v1.0.0 は fxdom の基準点である。
* 後方互換を壊す変更は禁止（MUST NOT）。
* 既存の Normative 規範を変更する場合は v1.1+ で行う（MUST）。
* v1.0.0 のまま許されるのは、意味を変えない明確化・誤字修正・Informative 追記のみである（MAY）。

---

## Appendix A. Examples (Informative)

### A.1 switch (basic form)

```html
<fx-switch by="$confirmResult">
  <fx-sequence slot="yes">
    <fx-call action="log" input="Saving..." />
    <fx-wait ms="1500" />
    <fx-call action="log" input="save complete" />
  </fx-sequence>

  <fx-call slot="default" action="log" input="Save cancelled." />
</fx-switch>
```

### A.2 if (then default by no slot)

```html
<fx-if test="$isOk">
  <!-- slot無しは全て then 扱い（MUST） -->
  <fx-call action="log" input="OK branch" />

  <fx-call slot="else" action="log" input="NG branch" />
</fx-if>
```

### A.3 yield (local template + input)

```html
<template id="fxConfirm">
  <fx-sequence>
    <fx-call action="confirm" input="$_" done="doneOfConfirm$" />
    <fx-wait until="$confirmAnswerResolved" />
    <fx-return value="$selectedConfirmAnswer" />
  </fx-sequence>
</template>

<fx-yield
  for="#fxConfirm"
  done="confirmResult$"
  input="Confirmation needed: Save this count?">
</fx-yield>
```

### A.4 yield (remote locator)

```html
<fx-yield for="wss://example.com/fx/confirm" input="$payload" done="$result" />
```

---

# END OF fxdom Element Specification v1.0.0