import type { FxExecutionContext, FxLoopNode, FxNode, FxRef } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'loop' }>;

const DEFAULT_MAX_ITERATIONS = 10000;

export class LoopNodeDefinition extends NodeDefinition<'loop'> {
  
  public readonly type = 'loop';

  public factory(cond: FxRef<boolean>, body: FxNode, options?: {
    maxIterations?: number;
    maxDuration?: number;
  }): ThisNode {
    return { type: 'loop', cond, body, ...options };
  }

  public *step({ node, run, context }: FxExecutionContext & { node: FxLoopNode; }): Generator<FxNode, void, any> {
    const cond = context.resolve(node.cond);
    const maxIterations = node.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxDuration = node.maxDuration;
    
    let iterations = 0;
    const startTime = maxDuration ? performance.now() : 0;
    
    while (cond()) {
      // 回数制限チェック
      if (maxIterations !== Infinity && ++iterations > maxIterations) {
        throw new Error(`Loop exceeded maximum iterations (${maxIterations}). Set max-iterations="infinity" for intentional infinite loops.`);
      }
      // 時間制限チェック
      if (maxDuration && (performance.now() - startTime) > maxDuration) {
        throw new Error(`Loop exceeded maximum duration (${maxDuration}ms).`);
      }
      yield* run(node.body);
    }
  }
}