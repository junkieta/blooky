// src/fx/nodes/parallel.ts
import type { CancelToken, FxExecutionContext, FxNode, FxParallelNode } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { createCancelToken } from '../../blooky-fx';
type ThisNode = Extract<FxNode, { type: 'parallel' }>;

let __parallelBranchCounter = 0;

export class ParallelNodeDefinition extends NodeDefinition<'parallel'> {
  public readonly type = 'parallel';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'parallel', steps };
  }

  public getChildNodes(node: FxParallelNode): null | FxNode[] {
    return node.steps;
  }

  public async handle({ node, context, execute }: FxExecutionContext & { node: ThisNode }): Promise<any> {
    const tokens = node.steps.map(()=>createCancelToken(context.cancelToken));
    try {
      const promises = node.steps.map((stepNode, i) => {
        const parentExecId = (context as any).executionId ?? `exec-${Date.now()}`;
        const childExecutionId = `${parentExecId}-p${++__parallelBranchCounter}-${i}`;

        const childCtx = Object.create(context, {
          executionId: { value: childExecutionId },
          cancelToken: { value: tokens[i] }
        });

        return execute(stepNode, childCtx);
      });
      // Wait for all children to complete and collect results
      return await Promise.all(promises);
    } finally {
      tokens.forEach((t) => t.cancel());
    }
  }
}