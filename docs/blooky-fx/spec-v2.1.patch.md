# blooky-fx Architecture Specification Patch

**Target Version:** 2.1 (Draft)
**Base Version:** 2.0
**Type:** Breaking Change / Architectural Refinement

## Summary of Changes

1. **Removal:** `FxCollapseNode` および `fx-collapse` の削除。
2. **Refinement:** FRP への値注入（Drip）は、Node の実行そのものではなく、Node/Flow の `exit` phase に付帯する `effect`（Binding）によってのみ行われることを明記。
3. **Semantics:** `done` (または `sink`) 属性による Document/Node 境界での Stream 接続の定義。

---

## 1. Core Concepts Modification

### 3.1 FxNode (Updated)

`FxCollapseNode` を型定義から削除します。

**Before (v2.0):**

```typescript
type FxNode =
  | FxFlowNode        // Document Template 定義
  | FxYieldNode       // Document 生成・実行委譲
  // ...
  | FxLoopNode        // ループ
  | FxCollapseNode    // Stream への値注入 [Deleted]
  | FxReturnNode      // 戻り値設定
  | FxNoneNode        // 空操作

```

**After (v2.1):**

```typescript
type FxNode =
  | FxFlowNode        // Document Template 定義
  | FxYieldNode       // Document 生成・実行委譲
  // ...
  | FxLoopNode        // ループ
  | FxReturnNode      // 戻り値設定
  | FxNoneNode        // 空操作

```

---

## 2. Examples Modification

`fx-collapse` を使用していた箇所を、`fx-return` や `fx-yield` のバインディングを用いた表現に修正します。

### 5.1 fx-flow as Document Template (Updated)

FRP への書き込み（メッセージ更新）を Node の責務から外します。あるいは、`fx-yield` の戻り値を Stream に流す例に変更します。

**Before (v2.0):**

```typescript
// fx-flow は Template
const confirmFlow = fx.flow(
  { $userInput: hold("")(inputStream$) },
  fx.sequence([
    fx.collapse("Confirm?", ref('messageStream$')), // [Deleted]
    fx.wait({ until: ref('$userConfirmed') }),
    fx.return(ref('$userInput'))
  ]),
  { id: 'confirmFlow' }
);

```

**After (v2.1):**

```typescript
// fx-flow は Template
const confirmFlow = fx.flow(
  { $userInput: hold("")(inputStream$) },
  fx.sequence([
    // メッセージ表示などは外部（View）の責務、
    // または Flow への入力引数として処理されるべきだが、
    // ここでは単純化のため wait と return に集中する
    fx.wait({ until: ref('$userConfirmed') }),
    fx.return(ref('$userInput'))
  ]),
  { id: 'confirmFlow' }
);

```

### 8.3 Remote Execution is Encapsulated (Updated)

Backend 側での `fx.collapse` を `fx.return` に変更します。Backend Timeline は値を返すだけであり、それをどこに流すかは Frontend 側の `fx-yield` の責務（または Transport の責務）です。

**Before (v2.0):**

```typescript
// Backend（Remote Timeline）
fx.flow({},
  fx.sequence([
    fx.call(ref('fetchData')),
    fx.call(ref('processData')),
    fx.collapse(true, ref('remoteCompleteStream$'))  // [Deleted]
  ])
)

```

**After (v2.1):**

```typescript
// Backend（Remote Timeline）
fx.flow({},
  fx.sequence([
    fx.call(ref('fetchData')),
    fx.call(ref('processData')),
    // 値を返して終了。Frontend への通知は Transport/Yield 層が行う
    fx.return({ status: 'complete' }) 
  ])
)

```

---

## 3. Semantics Refinement

### 9.5 FRP Integration (New Section)

FxNode から FRP への接続に関する新しいセクションを追加します。

**Add:**

> **9.5 FRP Output Binding**
> FxNode 自体が副作用として FRP Stream に値を注入（collapse）することは禁止される。
> Stream への値の反映は、Timeline が `exit` phase を処理する際の `effect apply` としてのみ行われる。
> **Binding Mechanism:**
> 開発者は `fx-yield` や Node のオプション（`done` / `sink`）を通じて、実行結果の送り先を指定する。
> ```typescript
> // ✅ Correct: 境界での接続
> fx.yield({
>   for: ref('confirmFlow'),
>   done: ref('confirmResultStream$') // exit value をここに drip する
> })
> 
> ```
> 
> 

> // ❌ Prohibited: ノードによる直接操作
> // fx.collapse(val, stream$)
> ```
> 
> これにより、「Node は意図を宣言し、Timeline が反映を行う」という原則が守られる。
> 
> ```
> 
> 

---

## 4. Constraint Updates

### 17.1 FxNode Constraints (Updated)

禁止事項を明文化します。

**Add:**

> **Stream/Prop Manipulation**
> * ❌ FxNode の `execute()` 内で Stream や Prop に値を push/set してはならない。
> * ❌ `FxCollapseNode` のような「書き込み専用ノード」を作成してはならない。
> * ✅ 値を `return` (yield output) し、Binding によって FRP に伝播させる。
> 
> 

---

## 5. Version History (Updated)

**Appendix C: Version History**

| Version | Date | Changes |
| --- | --- | --- |
| **2.1** | 2026-02-04 | **Breaking:** `FxCollapseNode` 削除。FRP への接続を `fx-yield` 等の `done` 属性による Binding に一本化。 |
| **2.0** | 2026-02-03 | Design Freeze: Flow Model 確定、fx-context → fx-flow、SubTimeline Model、Remote Flow |

---

**END OF PATCH**