import type { FxExecutionContext, FxNode } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'parallel' }>;

export class ParallelNodeDefinition extends NodeDefinition<'parallel'> {
  public readonly type = 'parallel';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'parallel', steps };
  }

  public async handle({ node, execute }: FxExecutionContext & { node: ThisNode }): Promise<any[]> {
    // すべてのPromiseが完了するのを待つ
    return Promise.all(node.steps.map((n)=>execute(n)));
  }  

}