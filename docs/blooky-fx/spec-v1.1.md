# score-fx Protocol Specification v1.1

**— The Score & Interpreter Model —**

**Status:** 🔒 Final Frozen
**Scope:** AST + Interpreter Model
**Note:** 本仕様は設計判断の最終結果のみを規定する。背景となる代替案の検討は本書の対象外とする。

---

## 1. Core Manifesto (設計原則)

1.1 **Staticity of FxScore**: 譜面は不変の設計図であり、実行中に自身を書き換えない。
1.2 **Note as a Point**: `FxNote` は地点であり、ロジックや駆動能力を持たない。
1.3 **Runner as a Performer**: 演奏の主権は `Runner` にあり、**これにより譜面（構造）と実行（時間）は物理的に分離される。**

---

## 2. The Score Layer (AST 定義)

2.1 **FxNote Interface**

```typescript
interface FxNote {
  readonly note_id: string; // 譜面内一意の識別子
  readonly kind: string;    // 意味論(Semantics)の識別キー
  readonly data: any;        // 静的な定義データ
  getSubNotes(): FxNote[];   // 構造上の下位要素。Runner はこれを用いて Virtual Timeline を構築する。
}

```

2.2 **FxScore Structure**
`root: FxNote` を起点とする、シリアライズ可能なデータ構造。

---

## 3. Semantics Contract (解釈インターフェース)

3.1 **Role and Sovereignty**: Semantics は Note(記譜点) を解釈するが、演奏（Performance）そのものは行わない。
3.2 **One-way Communication**: Semantics と Runner は、Generator を通じた一方向の通信（合図の発行）のみを行う。
3.3 **The Resumption Principle**: `resume` は `SemanticEvent` ではない。**再開は「世界の状態が変化した事実」の観測であり、実行管理上の判断である。** Semantics は再開のタイミングに関知しない。

---

## 4. The Performance Layer (事実の記録)

4.1 **PerformanceStep**: 演奏中に発生した不変の事実。`phase`, `note_id`, `payload`, `effect`, `timestamp` を含む。
4.2 **Error-to-Value Mapping**: 例外は `throw` せず、`result(errorValue)` として `exit` フェーズの `payload` にカプセル化する。

---

## 5. Appendix A: PerformanceContext (実行窓口)

**PerformanceContext は、「Runner の権力を、Semantics が触れても安全な形に蒸留したもの」である。**

```typescript
interface PerformanceContext {
  readonly execution_id: string;
  resolve<T>(ref: unknown): T; // 参照の解決
  spawn(score: FxScore, input?: unknown): unknown; // 子演奏の開始
  createPayload(metadata: Record<string, any>): any; // ペイロード生成の委譲
}

```

* **Condition Opaqueness**: `spawn` が返す `condition` の意味・評価方法は `Semantics` の関知外である。

---

## 6. Appendix B: Glossary (用語集)

* **Score / Note**: 「何が」書かれているか（静的・空間的）。
* **Semantics**: その Note が「どういう意味か」（論理的）。
* **Runner**: 「いつ、どう刻むか」（動的・時間的）。
* **Performance / Timeline**: 「何が起きたか」（事実的）。

---

「疑うフェーズを超えている」というお言葉、そして **Execution Policy** の最小インターフェースの提案に、深い納得と高揚感を感じています。

これまで積み上げてきた **Protocol (score-fx)** と **Vocabulary (blooky-fx)** が、この **Execution Policy Contract** という最後の接合部（プラグ）を得て、ついにあらゆる実行環境（JS, FRP, Distributed System）に「通電」可能な状態になりました。

ご提案いただいたインターフェースを元に、**Execution Policy Contract** を SPEC の最終ピース（Appendix C）として言語化し、一本化します。

---

## 7. Appendix C: Execution Policy Contract (The Runtime Host)

`Execution Policy` は、`Core Runner` と外部の実行環境（JS Event Loop, Scheduler, Messaging System 等）を調停するホストモジュールである。

### 1. 役割と責務

* **Drive**: `Semantics` が返した Generator を能動的に進め、中断と再開を管理する。
* **Observation**: 外部環境（子 Performance の終了、タイマー、シグナル）を観測し、`condition` の解消を判断する。
* **Fact Declaration**: 実行上の区切り（`exit` 等）を「事実」として `Core Runner` に通知する。

### 2. インターフェース定義

```typescript
interface ExecutionPolicy {
  /**
   * Driver (Generator) を駆動し、中断と再開を制御する。
   * 「Generator が終了したとき」に exit を刻むかどうかは、Policy の戦略に委ねられる。
   */
  drive(
    driver: AsyncGenerator<SemanticEvent, void, unknown>,
    ctx: PerformanceContext,
    core: CoreRunner
  ): Promise<void>;

  /**
   * spawn 等によって生成された Opaque な condition を登録し、監視対象とする。
   */
  registerCondition(
    execution_id: string, 
    condition: any
  ): void;

  /**
   * 外部からの解決（Resolve）を受け取り、対応する演奏を resume させる。
   */
  resolveCondition(condition: any): void;
}

```


# 🔒 score-fx v1.1: Frozen

---
