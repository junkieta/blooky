// src/fx/debugger.ts
import type { FxNode, ExecutionStep } from './types';

export type StepMode = 'into' | 'over' | 'out';

/**
 * DebugController: executionId 単位での pause/resume/step を管理
 */
export class DebugController extends EventTarget {
  private nodeIdMap = new WeakMap<object, string>();
  private idCounter = 1;

  // ブレークポイント管理
  private breakpointNodes = new WeakSet<object>();
  private breakpointIds = new Set<string>();

  // execution 単位の状態
  private pausedExecutions = new Set<string>();
  private pendingResolvers = new Map<string, (() => void)[]>();
  private executionDepth = new Map<string, number>();

  // ──── Node ID ────
  getNodeId(node: object) {
    let id = this.nodeIdMap.get(node);
    if (!id) {
      id = `n${this.idCounter++}`;
      this.nodeIdMap.set(node, id);
    }
    return id;
  }

  // ──── Breakpoints ────
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

  // ──── Execution Control ────
  pauseExecution(executionId: string) {
    this.pausedExecutions.add(executionId);
    this.dispatchEvent(new CustomEvent('paused', { detail: { executionId } }));
  }

  resumeExecution(executionId: string) {
    this.pausedExecutions.delete(executionId);
    const resolvers = this.pendingResolvers.get(executionId) ?? [];
    this.pendingResolvers.delete(executionId);
    for (const r of resolvers) r();
    this.dispatchEvent(new CustomEvent('resumed', { detail: { executionId } }));
  }

  stepExecution(executionId: string, mode: StepMode = 'into') {
    // 簡易実装：次のステップで再度一時停止
    this.resumeExecution(executionId);
    // 次の beforeStep で自動的に pause する
    this.pausedExecutions.add(executionId);
  }

  // ──── Hooks (called by middleware) ────
  async beforeStep(node: FxNode, step: ExecutionStep, executionId: string) {
    // depth 管理
    if (step.phase === 'init' || step.phase === 'prepare') {
      const depth = this.executionDepth.get(executionId) ?? 0;
      this.executionDepth.set(executionId, depth + 1);
    }

    // ブレークポイントチェック
    if (this.hasBreakpoint(node)) {
      this.pauseExecution(executionId);
    }

    // paused なら待機
    if (this.pausedExecutions.has(executionId)) {
      await new Promise<void>((resolve) => {
        const arr = this.pendingResolvers.get(executionId) ?? [];
        arr.push(resolve);
        this.pendingResolvers.set(executionId, arr);
      });
    }

    // イベント発火
    this.dispatchEvent(new CustomEvent('step', {
      detail: { node, step, executionId }
    }));
  }

  afterStep(node: FxNode, step: ExecutionStep, executionId: string) {
    // depth 管理
    if (step.phase === 'completed') {
      const depth = Math.max(0, (this.executionDepth.get(executionId) ?? 1) - 1);
      this.executionDepth.set(executionId, depth);
    }
    
    // イベント発火
    this.dispatchEvent(new CustomEvent('step-complete', {
      detail: { node, step, executionId }
    }));
  }

  // ──── Utilities ────
  isPaused(executionId: string): boolean {
    return this.pausedExecutions.has(executionId);
  }
}

export default DebugController;