// src/fx/nodes/context.ts
import type { AppContext, FxContextNode, ExecutionContext, FxNode, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

export class ContextNodeDefinition extends NodeDefinition<'context'> {
  public readonly type = 'context';
  
  public factory(context: AppContext, child: FxNode, id: string): FxContextNode {
    return { type: 'context', context, child, id };    
  }
  
  public getChildNodes(node: FxContextNode): FxNode[] {
    return node.child ? [node.child] : [];
  }
  
  public async *execute({ node, executeChild }: ExecutionContext & { node: FxContextNode }): AsyncGenerator<ExecutionStep, any> {
    yield {
      phase: 'init',
      node,
      data: { contextKeys: Object.keys(node.context) },
      visual: { 
        label: 'Setting up context',
        color: '#3B82F6'
      }
    };
    
    if (node.child) {
      const childGen = executeChild(node.child);
      let result;
      for await (const childStep of childGen) {
        yield childStep;
        result = childStep;
      }
      
      yield {
        phase: 'completed',
        node,
        data: { result },
        visual: { label: 'Context completed', color: '#10B981' }
      };
      
      return result;
    }
    
    yield {
      phase: 'completed',
      node,
      visual: { label: 'Empty context', color: '#6B7280' }
    };
  }
}