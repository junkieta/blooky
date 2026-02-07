// src/fx/nodes/loop.ts
import type { ExecutionContext, FxLoopNode, FxNote, FxRef, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNote, { type: 'loop' }>;

const DEFAULT_MAX_ITERATIONS = 10000;

export class LoopNodeDefinition extends NodeDefinition<'loop'> {
  public readonly type = 'loop';

  public factory(cond: FxRef<boolean>, body: FxNote, options?: {
    maxIterations?: number;
    maxDuration?: number;
  }): ThisNode {
    return { type: 'loop', cond, body, ...options };
  }

  public getSubNotes(node: FxLoopNode): FxNote[] {
    return [node.body];
  }

  public async *execute(context: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
    const { node, executeChild } = context;
    const cond = context.resolve(node.cond);
    const maxIterations = node.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxDuration = node.maxDuration;
    
    yield {
      phase: 'init',
      node,
      data: { maxIterations, maxDuration },
      visual: { label: 'Starting loop', color: '#3B82F6' }
    };
    
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
      
      yield {
        phase: 'iteration',
        node,
        data: { iteration: iterations },
        visual: { 
          label: `Loop iteration ${iterations}`,
          color: '#F59E0B'
        }
      };
      
      const childGen = executeChild(node.body);
      for await (const childStep of childGen) {
        yield childStep;
      }
    }
    
    yield {
      phase: 'completed',
      node,
      data: { iterations },
      visual: { 
        label: `Loop completed (${iterations} iterations)`, 
        color: '#10B981' 
      }
    };
  }
}