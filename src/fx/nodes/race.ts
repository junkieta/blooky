import type { CancelToken, FxExecutionContext, FxNode, FxRaceNode } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { createCancelToken } from '../../blooky-fx';
type ThisNode = Extract<FxNode, { type: 'race' }>;

let __branchCounter = 0;

export class RaceNodeDefinition extends NodeDefinition<'race'> {
  public readonly type = 'race';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'race', steps };
  }

  public getChildNodes(node: FxRaceNode): null | FxNode[] {
    return node.steps;
  }

  public async handle({ node,context,execute }: FxExecutionContext & { node: ThisNode }): Promise<any> {
    const raceTokens = node.steps.map(()=>createCancelToken(context.cancelToken));
    try {
      const promises = node.steps.map((stepNode, i) => {
        // parent executionId を継承してブランチ識別子を付与
        const parentExecId = (context as any).executionId ?? `exec-${Date.now()}`;
        const childExecutionId = `${parentExecId}-b${++__branchCounter}-${i}`;

        // 子コンテキストを作成（executionId と cancelToken を差し替え）
        const childCtx = Object.create(context, {
          executionId: { value: childExecutionId },
          cancelToken: { value: raceTokens[i] }
        });

        return execute(stepNode, childCtx);
      });
      return await Promise.race(promises);
    } finally {
      raceTokens.forEach((token)=>token.cancel());
    }
  }  

}