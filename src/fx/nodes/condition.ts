import type { FxConditionNode, FxExecutionContext, FxNode, FxRef } from '../types';
type ThisNode = Extract<FxNode, { type: 'condition' }>;
import { NodeDefinition } from '../NodeDefinition';

export class ConditionNodeDefinition extends NodeDefinition<'condition'> {
  public readonly type = 'condition';

  public factory(ifCond: FxRef<boolean>, thenBranch: FxNode, elseBranch?: FxNode): ThisNode {
    return { type: 'condition', if: ifCond, then: thenBranch, else: elseBranch };
  }

  public getChildNodes(node: FxConditionNode): null | FxNode[] {
    return node.else ? [node.then, node.else] : [node.then];
  }
  
  public *step({ node, run, context }: FxExecutionContext & { node: ThisNode }): Generator<FxNode, void, any> {
    const ok = context.resolve(node.if)();
    const targetBranch = ok ? node.then : node.else;
    if (targetBranch) {
      yield* run(targetBranch);
    }
  }

}