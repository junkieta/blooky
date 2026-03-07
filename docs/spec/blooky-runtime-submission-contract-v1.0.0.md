# blooky Runtime Submission Contract v1.0.0

**Status:** 🔒 Final / Frozen  
**Scope:** Plan Submission, Tick Batching, Commit Integrity
**Depends on:**

* blooky-fp v1.0.0
* blooky-context v1.0.0
* blooky Clock Specification v1.0.0（Atomic Commit / Conflict Prohibition）

---

## 0. Purpose

本仕様は、UI・Execution・外部入力を含むあらゆる入力経路から生成された
**DripPlan を Tick 単位で集約し、Atomic Commit する Runtime の契約**を定義する。

本仕様は以下を規定する：

1. Plan の生成原則
2. Plan の合成・検証規則
3. CommitPlan の完全性（Integrity）
4. ObservedPlan（観測用 view）の意味論
5. submit() の契約

本仕様は以下を対象外とする：

* Stream/Prop の計算意味論（fp の責務）
* Tick 生成戦略（clock/runtime integration の責務）
* DOM 投影（fv の責務）

---

# 1. Fundamental Model

## 1.1 DripPlan

```
type DripPlan = Array<[Prop<any>, any]>
```

DripPlan は **単一評価の帰結として得られる Prop 更新集合**である。

DripPlan は命令ではなく、**次状態の宣言**である。

---

## 1.2 CommitPlan/ObservedPlan
```
type CommitPlan = DripPlan;      // same representation, different semantics
type ObservedPlan = DripPlan;    // view type alias
```

### 規範

CommitPlan と DripPlan は 同一表現を持つ（MUST）。

CommitPlan は Tick 内で確定する状態遷移集合を意味する。

ObservedPlan は commit に供される更新集合の viewである。

型が同一であっても意味論は異なる（MUST）。

## 1.3 Error Model Reference（Normative）

Runtime の submit() が reject で返す error の型・意味は、
**blooky Clock Specification v1.0.0（Conflict/Fatal 境界）** に従わなければならない（MUST）。

Runtime は submit() の reject において `SubmitError` 以外を返してはならない（MUST NOT）。

### 1.4 Context Decode Compliance（Normative）

Runtime が ContextRef を解決する場合、その decode 規則は
**blooky-context Specification v1.0.0 §3.4 ** に従わなければならない（MUST）。

* 未登録 key は DECODE_MISSING_KEY として分類されなければならない（MUST）。
* decode 失敗を黙殺してはならない（MUST NOT）。

Context エラーは、実行構造エラーとは独立した内部分類として管理されなければならない（MUST）。

本規範は submit() の reject 契約を変更しない（MUST NOT interpret as extending submit reject conditions）。

### 1.5 Outcome Reference（Normative）

Outcome の分類・意味は score-fx Semantics Registry §4.6.4 に従う（MUST）。

---

### Additional Runtime Policy（Normative）

Clock/runtime が停止級（fatal）として分類するエラーは、
Runtime においても recoverable failure として扱ってはならない（MUST NOT）。
この種の例外は submit() reject 経路に載せてはならない（MUST NOT）。

# 2. Plan Generation Rules（Normative）

## 2.1 Legitimate Plan Sources（Normative）

DripPlan は、以下のいずれかの方法で生成されなければならない（MUST）：

1. `drip(value)(dripper)` によるデータフロー評価の結果
2. 既存の DripPlan に対する **構造的変換**（Structural Transformation）
3. 現在状態の読み取り `p()` に基づく **Snapshot 生成**

---

## 2.2 Structural Transformation（Normative）

Structural Transformation とは、既存 plan から

* エントリの再配列
* 同値重複の除去
* Snapshot 化（例：`[p, p()]`）
* 既存 Prop のみを対象とする写像

を行うことを指す。

Runtime は以下を行ってはならない（MUST NOT）：

* plan に含まれない Prop を追加すること
* 外部値を新たに注入すること
* 既存 plan のエントリ値を 破壊的に別値へ置換してはならない（MUST NOT）。

---

## 2.3 Snapshot Plan（Normative Clarification）

以下のような plan は許可される：

```ts
undoPlan = plan.map(([p]) => [p, p()])
```

これは：

* 既存 Prop に対する現在状態の取得であり
* データフロー整合性を破らない

ため、正当な plan 生成とみなされる。

---

### Clarification

Runtime が行ってよいのは：

* `drip(...)` の呼び出し
* 複数 DripPlan の合成
* 検証

Prop と値の組を直接生成してはならない。

---

## 2.2 No Arbitrary Value Injection

Runtime は DripPlan に対して：

* 新しい Prop を追加してはならない（MUST NOT）
* 既存エントリの値を変更してはならない（MUST NOT）
* 外部値を注入してはならない（MUST NOT）

DripPlan は常にデータフロー評価の帰結でなければならない。

---

# 3. Plan Composition

Runtime は同一 Tick 内で複数の DripPlan を合成してよい（MAY）。

合成結果は **CommitPlan** と呼ぶ。

---

## 3.1 CommitPlan Integrity（Normative）

CommitPlan は：

* 含まれるすべての Prop 更新を commit しなければならない（MUST）
* 任意の Prop 更新を omit してはならない（MUST NOT）

CommitPlan は単一の状態遷移である。

---

## 3.2 Deduplication Rule（Optional）

前提（Normative Clarification）:
各入力 DripPlan は blooky-fp v1.0.0 の一意性制約（同一 Prop の重複禁止）を満たしていなければならない（MUST）。
本節で扱う重複は、同一 Tick 内で複数 DripPlan を合成した結果として発生する重複に限る。

同一 Prop に対する複数更新が存在する場合：

* 値が同値であれば削除してよい（MAY）
* 異なる値であれば conflict である（MUST）
* Runtime は conflict を 事前検出して reject する（MAY）。
* ただし、Tick failure の最終確定規則は blooky Clock Specification v1.0.0 に従わなければならない（MUST）。

Runtime は conflict を 事前検出して reject しなければならない（MUST）。
Clock/runtime は conflict が存在する Tick を commit してはならない（MUST NOT）。

Conflict 解決規則（LWW 等）を提供してはならない（MUST NOT）。

---

# 4. ObservedPlan View（Normative）

Runtime は、Tick 内で合成・正規化・conflict 検証が完了し、
**CommitPlan（commit-intent）が確定した後に限り**、観測用の部分写像を生成してよい（MUST）。

この写像を **ObservedPlan** と呼ぶ。

```ts
type ObservedPlan = DripPlan
```

## 4.1 ObservedPlan Contract（Normative）

ObservedPlan は以下を満たさなければならない（MUST）：

1. ObservedPlan は CommitPlan の **subset** である。
2. ObservedPlan の生成は CommitPlan を変更してはならない（MUST NOT）。
3. ObservedPlan は commit に影響を与えてはならない（MUST NOT）。
4. CommitPlan が確定できない場合（conflict 等）、ObservedPlan を生成してはならない（MUST NOT）。

## 4.2 Timing Semantics（Normative）

Runtime は以下の順序を守らなければならない（MUST）：

1. DripPlan を合成する。
2. Conflict 検証を行う。
3. CommitPlan を確定する。
4. ObservedPlan を生成し observer に通知する。
5. CommitPlan を atomic commit する。

ObservedPlan は常に「commit 予定として確定した更新集合」に基づくものでなければならない（MUST）。

---

# 5. submit() Contract（Normative）

```ts
submit(plan: DripPlan): Promise<CommitPlan>
```

submit は以下を実行しなければならない（MUST）：

1. plan を Tick に予約する。
2. 同一 Tick 内の他 plan と合成する（MAY）。
3. Conflict 検証を行う。
4. CommitPlan を確定する。
5. CommitPlan を Atomic Commit する。
6. Commit 成功時に Promise を resolve する。
7. Conflict 発生時に限り Promise を `SubmitError` で reject する。

---

## 5.1 Conflict Handling（Normative）

Conflict は Commit 前に検出されなければならない（MUST）。

* Conflict が検出された場合、Runtime は commit を実行してはならない（MUST NOT）。
* Runtime は submit の Promise を reject しなければならない（MUST）。
* Conflict 発生時、ObservedPlan を生成してはならない（MUST NOT）。

Runtime は conflict 解決規則（LWW 等）を提供してはならない（MUST NOT）。

---

## 5.2 Commit Failure Policy（Normative）

CommitPlan 確定後の commit 操作は、整合性が保証された状態で実行される前提である。

commit 実行中に例外が発生した場合、それは：

* FRP または Runtime の整合性違反である。

Runtime はこの例外を recoverable failure として扱ってはならない（MUST NOT）。

実装は以下を行わなければならない（MUST）：

* 致命的エラーとして処理する
* Tick 処理を停止する（通常処理へ復帰しない）

実装は以下を行ってよい（MAY）：

* プロセス停止
* システム再起動要求

commit 実行中の例外は通常の submit reject 経路として扱ってはならない（MUST NOT）。

---

# 6. Clock Ownership (Optional Section)

Clock Prop を Runtime が所有する場合：

* Clock を更新する Dripper は非公開でなければならない（MUST）
* 外部 plan が Clock Prop を含んではならない（MUST NOT）

Clock Prop は参照してよい（MAY）が、外部から更新してはならない。

---

# 7. Observer Boundary（Normative）

Observer は、CommitPlan 確定後かつ commit 実行前に通知される観測者である。

Observer は：

* CommitPlan 由来の ObservedPlan（CommitPlan の subset view）を受け取る（MUST）。
* plan を編集してはならない（MUST NOT）。
* commit 制御に介入してはならない（MUST NOT）。

## 7.1 Invocation Timing（Normative）

Runtime は以下の順序を守らなければならない（MUST）：

1. DripPlan を合成する。
2. Conflict 検証を行う。
3. CommitPlan を確定する。
4. ObservedPlan を生成し Observer に通知する（MAY）。
5. CommitPlan を atomic commit する。

Observer が受け取る ObservedPlan は、常に「commit 予定として確定した CommitPlan」に基づくものでなければならない（MUST）。

## 7.2 Isolation Policy（Normative）

Observer は Monitoring 機構であり、Runtime の commit 成否を左右してはならない。

* Observer 内で例外が発生しても、Runtime は commit を中止してはならない（MUST NOT）。
* Observer 内例外により、submit() の Promise を reject してはならない（MUST NOT）。
* 実装は、Observer 内例外をログ・収集・隔離してよい（MAY）。
* Runtime は Observer を同期観測境界として扱わなければならない（MUST）。
* Observer の戻り値を await してはならない（MUST NOT）。
* Promise rejection 等の非同期失敗は診断目的で収集してよいが、submit()/commit 成否に影響させてはならない（MUST NOT）。

Observer の失敗は recoverable error として submit() の reject 経路に載せてはならない（MUST NOT）。

---

# 8. Design Guarantees

本契約により以下が保証される：

* Plan は常にデータフロー評価の帰結である
* CommitPlan は単一状態遷移である
* Runtime は状態を捏造しない
* Observer は状態変化を投影するのみである
* Conflict は曖昧さを残さず失敗として確定する

---

# 9. Non-Goals

本仕様は以下を提供しない：

* rollback
* branch/merge
* middleware
* last-write-wins
* partial commit
* plan rewriting

これらは上位層で実装されるべきである。

---

