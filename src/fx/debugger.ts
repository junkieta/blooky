// src/fx/debugger.ts
import type { FxNote, ExecutionStep } from './types';

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

  // 🔥 ステップモード管理
  private stepMode = new Map<string, StepMode | null>();

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
    console.log('[DebugController] pauseExecution called:', executionId);
    this.pausedExecutions.add(executionId);
    this.stepMode.delete(executionId); // ステップモードをクリア
    this.dispatchEvent(new CustomEvent('paused', { detail: { executionId } }));
    console.log('[DebugController] Paused executions:', Array.from(this.pausedExecutions));
  }

  resumeExecution(executionId: string) {
    console.log('[DebugController] resumeExecution called:', executionId);
    this.pausedExecutions.delete(executionId);
    this.stepMode.delete(executionId);
    
    const resolvers = this.pendingResolvers.get(executionId) ?? [];
    console.log('[DebugController] Resolving', resolvers.length, 'pending promises');
    this.pendingResolvers.delete(executionId);
    
    for (const r of resolvers) r();
    
    this.dispatchEvent(new CustomEvent('resumed', { detail: { executionId } }));
  }

  stepExecution(executionId: string, mode: StepMode = 'into') {
    console.log('[DebugController] stepExecution called:', executionId, mode);
    
    // 修正: ステップモードを設定してから resume
    this.stepMode.set(executionId, mode);
    
    // 現在のステップを解放
    const resolvers = this.pendingResolvers.get(executionId) ?? [];
    console.log('[DebugController] Stepping: resolving', resolvers.length, 'promises');
    this.pendingResolvers.delete(executionId);
    
    for (const r of resolvers) r();
    
    // 次のステップで再度停止するためにpausedに追加
    // ただし、すぐには停止せず、1ステップ実行してから停止
    this.pausedExecutions.add(executionId);
    
    this.dispatchEvent(new CustomEvent('step-requested', { detail: { executionId, mode } }));
  }

  // ──── Hooks (called by middleware) ────
  async beforeStep(node: FxNote, step: ExecutionStep, executionId: string) {

    const rootExecutionId = executionId.slice(0, executionId.indexOf(":"));

    console.log('[DebugController] beforeStep:', {
      executionId: rootExecutionId,
      phase: step.phase,
      nodeType: node.type,
      isPaused: this.pausedExecutions.has(rootExecutionId),
      stepMode: this.stepMode.get(rootExecutionId)
    });

    // depth 管理
    if (step.phase === 'init' || step.phase === 'prepare') {
      const depth = this.executionDepth.get(rootExecutionId) ?? 0;
      this.executionDepth.set(rootExecutionId, depth + 1);
    }

    // ブレークポイントチェック
    if (this.hasBreakpoint(node)) {
      console.log('[DebugController] Breakpoint hit!');
      this.pauseExecution(rootExecutionId);
    }

    // 🔥 ステップモードの処理
    const currentStepMode = this.stepMode.get(rootExecutionId);
    if (currentStepMode) {
      console.log('[DebugController] Step mode active:', currentStepMode);
      // ステップモードをクリア（1回だけ実行）
      this.stepMode.delete(rootExecutionId);
      // 次のステップで停止するためにpausedに追加
      this.pausedExecutions.add(rootExecutionId);
    }


    // 🔥 paused なら待機
    if (this.pausedExecutions.has(rootExecutionId)) {
      console.log('[DebugController] Execution is paused, waiting...');
      
      await new Promise<void>((resolve) => {
        const arr = this.pendingResolvers.get(rootExecutionId) ?? [];
        arr.push(resolve);
        this.pendingResolvers.set(rootExecutionId, arr);
        console.log('[DebugController] Promise added, total pending:', arr.length);
      });
      
      console.log('[DebugController] Promise resolved, continuing execution');
    }

    // イベント発火
    this.dispatchEvent(new CustomEvent('step', {
      detail: { node, step, executionId: rootExecutionId }
    }));
  }

  afterStep(node: FxNote, step: ExecutionStep, executionId: string) {
    console.log('[DebugController] afterStep:', {
      executionId,
      phase: step.phase,
      nodeType: node.type
    });

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

  // 🔥 デバッグ用: 現在の状態を表示
  getDebugState(executionId: string) {
    return {
      isPaused: this.isPaused(executionId),
      pendingResolvers: this.pendingResolvers.get(executionId)?.length ?? 0,
      stepMode: this.stepMode.get(executionId),
      depth: this.executionDepth.get(executionId)
    };
  }
}

export default DebugController;