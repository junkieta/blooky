import type { FxNode, FxRef } from '../types';
type ThisNode = Extract<FxNode, { type: 'condition' }>;
import { NodeDefinition } from '../NodeDefinition';

export class ConditionNodeDefinition extends NodeDefinition<'condition'> {
  public readonly type = 'condition';

  public factory(ifCond: FxRef<boolean>, thenBranch: FxNode, elseBranch?: FxNode): ThisNode {
    return { type: 'condition', if: ifCond, then: thenBranch, else: elseBranch };
  }

}