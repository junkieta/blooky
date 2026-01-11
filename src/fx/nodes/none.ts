// src/fx/nodes/none.ts
import type { ExecutionContext, FxNode, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNode, { type: 'none' }>;

export class NoneNodeDefinition extends NodeDefinition<'none'> {
  public readonly type = 'none';

  public factory(): ThisNode {
    return { type: 'none' };
  }

  public async *execute({ node }: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep> {
    yield {
      phase: 'completed',
      node,
      visual: { label: 'No operation', color: 'gray' }
    };
  }
}