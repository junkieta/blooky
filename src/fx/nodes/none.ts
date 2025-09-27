import type { FxExecutionContext, FxNode } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'none' }>;

export class NoneNodeDefinition extends NodeDefinition<'none'> {
  public readonly type = 'none';

  public factory(): ThisNode {
    return { type: 'none' };
  }

  public handle(context: FxExecutionContext & { node: { type: 'none'; id?: string; }; }) {
    
  }

}