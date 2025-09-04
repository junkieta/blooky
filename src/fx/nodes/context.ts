import type { AppContext, FxContextNode, FxExecutionContext, FxNode, FxRef } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'context' }>;

export class ContextNodeDefinition extends NodeDefinition<'context'> {
  public readonly type = 'context';
  public factory(context: AppContext, child: FxNode): FxContextNode {
    return { type: 'context', context, child };    
  }
  public getChildNodes(node: FxContextNode): null | FxNode[] {
    return [node.child];
  }
}


