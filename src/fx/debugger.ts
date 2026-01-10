// src/fx/debugger.ts
// DebugController: executionId 単位での pause/resume/step を扱うコントローラ（MVP実装）

export type StepMode = 'into' | 'over' | 'out';

/**
 * DebugController
 * - executionId 単位での pause/resume/step を管理する。
 * - ノードIDは WeakMap で管理し、ブレークポイントは WeakSet と ID キャッシュで扱う。
 *
 * 補足:
 * - beforeNode / afterNode はミドルウェアから呼ばれる（ExecContext に debugController と executionId を乗せる）。
 * - 単純で安全な実装を優先。将来的に NodeDefinition.step と連携して細粒度ステップを実装する。
 */
export class DebugController {
  private nodeIdMap = new WeakMap<object,string>();
  private idCounter = 1;

  // ブレークポイント管理（ノード参照を WeakSet で持つ）
  private breakpointNodes = new WeakSet<object>();
  private breakpointIds = new Set<string>(); // UI 表示用キャッシュ

  // execution 単位の状態
  private pausedExecutions = new Set<string>(); // executionId が一時停止中
  private pendingResolvers = new Map<string, (() => void)[]>(); // executionId -> resolver[]
  private executionDepth = new Map<string, number>(); // executionId -> depth
  private resumeUntilTargetDepth = new Map<string, number | null>(); // executionId -> targetDepth|null
  private stepMode = new Map<string, StepMode>(); // optional per-execution step mode

  // ------ Node ID ------
  getNodeId(node: object) {
    let id = this.nodeIdMap.get(node);
    if(!id) {
      id = `n${this.idCounter++}`;
      this.nodeIdMap.set(node, id);
    }
    return id;
  }

  // ------ Breakpoints API ------
  addBreakpointNode(node: object) {
    this.breakpointNodes.add(node);
    this.breakpointIds.add(this.getNodeId(node));
  }
  removeBreakpointNode(node: object) {
    this.breakpointNodes.delete(node);
    this.breakpointIds.delete(this.getNodeId(node));
  }
  clearAllBreakpoints() {
    this.breakpointNodes = new WeakSet<object>();
    this.breakpointIds.clear();
  }
  hasBreakpoint(node: object) {
    return this.breakpointNodes.has(node);
  }
  listBreakpointIds() {
    return Array.from(this.breakpointIds);
  }

  // ------ Execution lifecycle helpers ------
  ensureExecution(executionId: string) {
    if(!this.executionDepth.has(executionId)) {
      this.executionDepth.set(executionId, 0);
      this.resumeUntilTargetDepth.set(executionId, null);
    }
  }

  // Pause / Resume API (per execution)
  pauseExecution(executionId: string) {
    this.ensureExecution(executionId);
    this.pausedExecutions.add(executionId);
  }

  resumeExecution(executionId: string) {
    this.ensureExecution(executionId);
    this.pausedExecutions.delete(executionId);
    const resolvers = this.pendingResolvers.get(executionId) ?? [];
    this.pendingResolvers.delete(executionId);
    for(const r of resolvers) r();
  }

  // Step API: mode は into/over/out
  stepExecution(executionId: string, mode: StepMode = 'into') {
    this.ensureExecution(executionId);
    const depth = this.executionDepth.get(executionId) ?? 0;
    if(mode === 'into') {
      // 次のノード到達で停止を期待する簡易実装：resume する（next beforeNode 到達時に pause を想定）
      this.resumeUntilTargetDepth.set(executionId, null);
      this.resumeExecution(executionId);
    } else {
      // over / out: 現在の深さからターゲット深さを決めて resume
      const target = Math.max(0, depth - 1);
      this.resumeUntilTargetDepth.set(executionId, target);
      this.resumeExecution(executionId);
    }
    this.stepMode.set(executionId, mode);
  }

  // Called by middleware: node enter
  async beforeNode(node: object, executionId: string) {
    this.ensureExecution(executionId);

    // depth++
    this.executionDepth.set(executionId, (this.executionDepth.get(executionId) ?? 0) + 1);

    // breakpoint に当たれば pause
    if(this.hasBreakpoint(node)) {
      this.pauseExecution(executionId);
    }

    // paused なら待つ
    if(this.pausedExecutions.has(executionId)) {
      await new Promise<void>((resolve) => {
        const arr = this.pendingResolvers.get(executionId) ?? [];
        arr.push(resolve);
        this.pendingResolvers.set(executionId, arr);
      });
    }

    // もし resumeUntilTargetDepth が set されており、かつ現在 depth <= target の場合、
    // すでに到達済みなので pause をかける（安全措置）
    const maybeTarget = this.resumeUntilTargetDepth.get(executionId);
    if(maybeTarget !== null && (this.executionDepth.get(executionId) ?? 0) <= maybeTarget) {
      this.pauseExecution(executionId);
      this.resumeUntilTargetDepth.set(executionId, null);
    }
  }

  // Called by middleware: node exit
  afterNode(node: object, executionId: string) {
    const cur = Math.max(0, (this.executionDepth.get(executionId) ?? 1) - 1);
    this.executionDepth.set(executionId, cur);

    const target = this.resumeUntilTargetDepth.get(executionId);
    if(target !== null && cur <= target) {
      // 到達したら pause に戻す
      this.pauseExecution(executionId);
      this.resumeUntilTargetDepth.set(executionId, null);
    }
  }

  // Utility for UI
  listBreakpointsForUI() {
    return this.listBreakpointIds();
  }
}

export default DebugController;