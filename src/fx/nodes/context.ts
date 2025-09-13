import type { AppContext, FxContextNode, FxExecutionContext, FxNode, FxRef } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'context' }>;

export class ContextNodeDefinition extends NodeDefinition<'context'> {
  public readonly type = 'context';
  public factory(context: AppContext, child: FxNode, id:string): FxContextNode {
    return { type: 'context', context, child, id };    
  }
  public getChildNodes(node: FxContextNode): null | FxNode[] {
    return node.child ? [node.child] : null;
  }
  public *step({ run,node }: FxExecutionContext & { node: FxContextNode; }): Generator<FxNode, void, any> {
    const child = node.child;
    if(child.type === "sequence") {
      for(let step of child.steps)
        if(step.type !== "context")
          yield * run(step);
    }
    else {
      yield * run(child);
    }
  }
}


