import type { CancelToken, FxExecutionContext, FxNode, FxRaceNode } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { createCancelToken } from '../../blooky-fx';
type ThisNode = Extract<FxNode, { type: 'race' }>;

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
      const promises = node.steps.map((stepNode, i) =>
        execute(stepNode,Object.create(context, { cancelToken: { value: raceTokens[i] } }))
      );
      return await Promise.race(promises);
    } finally {
      raceTokens.forEach((token)=>token.cancel());
    }
  }  

}