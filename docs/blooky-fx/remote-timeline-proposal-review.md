# runtime/ Remote 統合 Step スキーマ提案レビュー

## 結論

提案の方向性は **概ね妥当** です。特に、`origin/timeline_id/tick_index/step_index/execution_id` を共通キーとして持ち、Step 列から Snapshot を再配置（reconstruction）する考え方は、`implements-projection.md` の「TimelineSnapshot は観測結果の再配置」という方針と整合します。

ただし、現行実装・既存 spec（v1.0 系）と一気通貫に合わせるために、以下の修正を入れないと後方互換と意味論が崩れます。

---

## 良い点（採用推奨）

1. **transport 非依存の順序キーを明示している点**
   - `tick_index` と `step_index` を分離する方針は、timestamp 依存を避けられるため妥当。

2. **Step 列→Snapshot 再配置の分離**
   - DevTools が「受信した Step を直接 DOM に当てない」方針は、Remote 遅延・欠落の診断可能性を上げる。

3. **terminate を宣言として扱う点**
   - `terminate` と `exit/cancel` を分離する発想は、最終状態の閉包（closed state）を保証しやすい。

4. **race loser cancel の明示**
   - Remote 表示で “負け側が走り続ける” 問題を避けるために必須。

---

## そのままでは不整合になる点（要修正）

### 1) `phase` 名の互換

提案の最小集合は `enter/effect/suspend/resume/exit/terminate/cancel` ですが、現行 runtime は `result` も emit します。

- `dispatchEvent` が `effect` の戻り値結果で `phase: "result"` を emit。
- `dispatchEvent` が `ev.type === "result"` でも `phase: "result"` を emit。

よって Remote 契約に `result` を含めないと、既存ローカル実装とイベント同型性を失います。

**推奨:**
- v1 transport 契約では `result` を許容 phase として含める。
- もし将来廃止するなら、runtime 側の emit 方針を先に揃えてから version を上げる。

### 2) `step_index` のスコープ定義不足

提案文は「tick 内順序」と読めるが、merge 実装には「tick を跨ぐ進み方」の規則が未固定。

**推奨:**
- `step_index` は **`(origin, timeline_id, tick_index)` 内で 0..N の連番** と明記。
- `tick_index` は **`(origin, timeline_id)` 内で単調増加・欠落許容** と明記。
- 欠落は transport 上の欠落であり、runtime が欠落を生成してよい意味ではないことも明記。

### 3) global sort の tie-break が因果を壊す可能性

`tick_index -> origin -> step_index` の全体 sort は、origin 間の因果（受信順 / bridge付与順）を保持できません。

**推奨（最小）:**
- 受信時に DevTools 側で `arrival_seq`（単調）を振る。
- 並び順を `tick_index -> arrival_seq` にして、同 tick 内の origin 横断は到着順で安定化。
- 真の因果順が必要なら将来 `global_seq`（bridge 採番）を追加。

### 4) `execution_id` 文字列仕様を固定しすぎない

提案例は `root:sequence:call` のような階層エンコード前提ですが、文字列フォーマットを spec で固定すると将来の executor 実装差異を阻害します。

**推奨:**
- `execution_id` は opaque string とする。
- 親子復元は `data.parent_execution_id`（enter 時）を正式キーにする。
- `execution_id` の可読フォーマットは non-normative（実装例）へ。

### 5) terminate 後終端 step の MUST を契約化

提案は正しいが、仕様文として MUST を強く書く必要あり。

**推奨規定文（案）:**
- `terminate` を emit した execution は、同一 execution について **必ず最終終端 step（`exit` or `cancel`）を1回 emit** しなければならない。
- 以後その execution に対して追加 step は emit してはならない。

### 6) race loser reason の語彙

提案中に `race_loser` と `race` が混在している。reason 語彙が揺れると可視化・集計で破綻する。

**推奨:**
- `cancel.reason` は enum 化し、少なくとも `"race_loser"` を正規値に固定。
- 互換入力（`"race"`）は DevTools で正規化して扱う。

---

## 現行コードとの一致性チェック（短評）

- `runChild(child, overrideAppContext?, overrideCancelToken?)` は既に拡張済みで、提案との相性は良い。
- race は child token を配って winner 以外を cancel しており、方向性は合っている。
- terminate 捕捉時に runner が `exit` を emit しているため、終端閉包の実装方針はすでにある。
- ただし `result` phase の存在、cancel reason の表記ゆれ、global merge の規約不足は、Remote 契約化前に整理が必要。

---

## 一気通貫（runtime→remote→devtools）で今すぐ固定すべき最小契約

1. **Step envelope（必須）**
   - `v, origin, timeline_id, tick_index, step_index, execution_id, phase, node, data`

2. **phase（v1）**
   - `enter, effect, suspend, resume, result, terminate, exit, cancel`

3. **順序規約**
   - stream 内：`tick_index` 単調増加、同 tick 内 `step_index` 連番
   - DevTools merge：`tick_index` 主キー + `arrival_seq` 安定化

4. **終端規約**
   - `terminate` の後は必ず `exit|cancel` を1回
   - `exit|cancel` 後の追加 step は禁止

5. **cancel reason 規約**
   - 正規 enum（`race_loser/user/timeout/error` など）

この5点が固まれば、`implements-projection.md` の再配置モデルと、spec v1.0 の Remote 包含原則を壊さずに、runtime/ から remote までのタイムラインを実装可能です。


---

## DevTools v1.0.0（現行） vs 提示 Draft（可視化完全性寄り）の適用判断

### 結論（今回の実装前提）

**現時点では、現行の `docs/spec/blooky-devtools-spec-v1.0.0.md` を正規（Normative）として維持するのが適切**です。
提示 Draft は方向性として有益ですが、現在の runtime/bridge/devtools の整合条件では **v1.0.0 追補ではなく v1.1+ の拡張仕様**として切り出す方が安全です。

### 理由

1. **順序主権の所在が衝突する可能性**
   - 現行 v1.0.0 は「`tick_index` を唯一の順序基準」「DevTools は順序キーを生成しない」を強く規定している。
   - 提示 Draft は Observability Bus に total ordering 付与責務を持たせており、条文の読み方次第で DevTools 側順序生成と解釈されうる。

2. **Execution Fact の最小形が現行 runtime の phase 語彙と未整合**
   - 現行 runtime は `effect/result/terminate/cancel` を emit する。
   - Draft 例で想定しがちな `active` 中心モデルに寄せると、runtime 実測事実と devtools 表示語彙がズレる。

3. **Remote まで見据えるなら、Fact 最小形に `origin/timeline_id/tick_index/step_index` が必要**
   - Draft の Execution Fact 最小要件は `execution_id + step_index + phase` ベースで、remote merge の衝突回避に不足。
   - 今回レビューした一気通貫要件（stream 境界・順序規約・終端規約）を先に固定する必要がある。

4. **at-least-once の許容は妥当だが、重複同定キーの規定が必要**
   - Draft は重複配送許容を置いているが、idempotent 処理に必要な同定キー（または同定規則）が未規定。
   - ここを曖昧にすると projector 側で重複描画・状態巻戻りが起きうる。

### 推奨する進め方（実装リスク最小）

- **Step 1（今）**: 現行 v1.0.0 を規範仕様として維持。
- **Step 2**: 「Observability Bus Profile v1.1（または v2 Draft）」を別文書で追加。
  - ここでのみ、`origin/timeline_id/tick_index/step_index/execution_id/phase` を Execution Fact 最小形に昇格。
  - 重複同定キー、gap 表示、terminate→final step MUST を規範化。
- **Step 3**: bridge 側に global ordering を持たせる場合は、DevTools ではなく bridge 由来キーを一次情報として採用。

この分離により、「現行凍結仕様の互換性」を壊さずに、可視化完全性（Bus 中心）へ段階移行できます。


---

## Remote 統合 Step スキーマ v1（Normative draft）

### 0. 目的

- runtime が emit する Step を **transport 非依存**に運び、DevTools が **Step 列から Snapshot を再配置**できること。
- timestamp に依存せず、**tick_index / step_index** を順序キーとすること。

### 1. Step Envelope（必須フィールド）

Step は次のフィールドを必ず持つ（MUST）。

```ts
type StepV1 = {
  v: 1

  // stream identity
  origin: string
  timeline_id: string

  // ordering
  tick_index: number
  step_index: number

  // execution identity
  execution_id: string
  node: { type: string; id?: string }

  // phase & payload
  phase: PhaseV1
  data?: unknown
}
```

#### 1.1 `execution_id` は opaque（重要）

- `execution_id` の文字列表現フォーマットは規定しない（MUST NOT）。
- 親子復元は `enter` の `data.parent_execution_id` により行ってよい（MAY）。

### 2. Phase Vocabulary v1（closed set）

`phase` は以下の閉集合のみ（MUST）。

```ts
type PhaseV1 =
  | "enter"
  | "effect"
  | "suspend"
  | "resume"
  | "result"
  | "terminate"
  | "exit"
  | "cancel";
```

- 互換性理由：現行 runtime が `result` を emit するため、v1 では `result` を含める（MUST）。

### 3. `step_index` / `tick_index` の順序規約（Normative）

#### 3.1 stream 内順序（MUST）

同一 `(origin, timeline_id)` の Step 列は、次を満たさなければならない（MUST）。

1. `tick_index` は単調増加（monotonic increasing）である（MUST）。
2. 同一 `tick_index` 内で `step_index` は **0..N の連番**で、欠落があってはならない（MUST NOT）。
3. `step_index` は tick を跨いで継続しない（MUST NOT）。
   - すなわち `(origin,timeline_id,tick_index)` ごとに 0 から開始する（MUST）。

#### 3.2 欠落の意味（重要）

- transport 上の欠落（通信断・ロス）は起こりうるが、**runtime が欠落を生成してよい**ことを意味しない（MUST NOT）。

### 4. DevTools merge の安定化規約（Normative）

#### 4.1 tie-break は arrival_seq を使う（MUST）

異なる origin 間では `tick_index` だけでは因果が確定しないため、DevTools は受信時に単調な `arrival_seq` を付与し、安定化に用いる（MUST）。

DevTools の並べ替えキー（推奨）：

1. `tick_index`（昇順）
2. `arrival_seq`（昇順）
3. （任意）`origin` / `step_index`

- `tick_index -> origin -> step_index` は因果を壊しうるので標準にはしない（SHOULD NOT）。

### 5. 終端規約（terminate / exit / cancel）

#### 5.1 terminate の閉包（MUST）

同一 `execution_id` について、`terminate` を emit した場合：

1. **必ず** `exit` または `cancel` を **ちょうど 1 回** emit しなければならない（MUST）。
2. `exit|cancel` の後、その execution に対する追加 Step を emit してはならない（MUST NOT）。

#### 5.2 terminate の意味

- `terminate` は宣言であり、**最終状態の閉包**は `exit|cancel` で表す（上記 MUST）。

### 6. cancel reason 語彙（Normative）

`cancel` の `data` は少なくとも次を満たす（MUST）。

```ts
type CancelDataV1 = {
  reason: "race_loser" | "user" | "timeout" | "error";
}
```

- `"race"` 等の揺れは DevTools 正規化の対象としてよい（MAY）が、送信側の正規値は `"race_loser"` に固定（MUST）。

### 7. `data` の推奨形（最小）

これは “推奨（SHOULD）” として扱い、opaque を阻害しない範囲で統一する。

- `enter`: `{ parent_execution_id?: string }`
- `effect`: `{ ref: unknown }`
- `suspend/resume`: `{ until: unknown }`
- `result`: `{ value: unknown }`
- `terminate`: `{ value?: unknown }`
- `exit`: `{ result?: unknown }`
- `cancel`: `{ reason: ... }`

## 実装への反映（最小変更点）

### A) runtime 側：phase の整備

- `result` phase は v1 に残す。
- `terminate` 捕捉時に `exit|cancel` を必ず emit（規範を固定）。

### B) DevTools 側：arrival_seq 付与

- 受信パイプで `arrival_seq++` を付与する。
- ソートは `tick_index -> arrival_seq` を標準にする。

### C) race loser cancel

- reason は `"race_loser"` を固定する。
- remote 表示整合のため v1 MUST とする。

## 一気通貫への評価

この v1 契約で、ローカル runtime の Step と remote の Step を同型に運び、`implements-projection.md` の再配置モデルへ接続可能。
特に以下が揃う点を重視する。

- `tick_index/step_index` による順序（timestamp 非依存）
- `arrival_seq` による origin 横断安定化
- `terminate` 閉包（UI で終端が閉じる）
- `cancel.reason` enum（race 可視化・集計が安定）
