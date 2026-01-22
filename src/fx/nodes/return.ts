// src/fx/nodes/return.ts
import type { FxNode, FxRef, ExecutionContext, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { blooky } from '../../blooky-fp';

type ThisNode = Extract<FxNode, { type: 'return' }>;

export const RETURN_VALUE = Symbol("RETURN_VALUE");

export class ReturnNodeDefinition extends NodeDefinition<'return'> {
  public readonly type = 'return';

  public factory(value: FxRef<any>): ThisNode {
    return { type: 'return', value };
  }

// src/fx/nodes/return.ts

  public async *execute(context: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
    const { node, appContext } = context;
    yield {
      phase: 'prepare',
      node,
      visual: { label: 'Preparing return', color: '#3B82F6' }
    };
    
    if (typeof appContext[RETURN_VALUE] !== "function") {
      throw blooky.error('flow', {
        code: 'INVALID_RETURN_CONTEXT',
        message: 'fx-return: This node must be called within a flow initiated by fx-yield',
        requiredContext: 'fx-yield initiated flow',
        suggestions: ['Use fx-return only within fx-yield target flows']
      });
    }
    
    const value = node.value ? await context.resolve(node.value)() : undefined;
    
    yield {
      phase: 'returning',
      node,
      data: { value },
      visual: { 
        label: 'Returning value',
        color: '#F59E0B',
        icon: '⤵️'
      }
    };
    
    appContext[RETURN_VALUE](value);
    context.cancelToken.cancel('return'); //  理由を指定
    
    yield {
      phase: 'completed',
      node,
      visual: { label: 'Return completed', color: '#10B981' }
    };
    
    return value;
  }
}