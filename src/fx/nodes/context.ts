// src/fx/nodes/context.ts
import type { AppContext, FxContextNode, ExecutionContext, FxNode, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNode, { type: 'context' }>;

export class ContextNodeDefinition extends NodeDefinition<'context'> {
  public readonly type = 'context';
  
  public factory(context: AppContext, child: FxNode, id: string): FxContextNode {
    return { type: 'context', context, child, id };    
  }
  
  public getChildNodes(node: FxContextNode): FxNode[] {
    return node.child ? [node.child] : [];
  }
  
  public async *execute({ node, executeChild, appContext }: ExecutionContext & { node: FxContextNode }): AsyncGenerator<ExecutionStep, any> {
    yield {
      phase: 'init',
      node,
      data: { contextKeys: Object.keys(node.context), hasId: !!node.id },
      visual: { 
        label: node.id ? `Defining context "${node.id}"` : 'Setting up context',
        color: '#3B82F6'
      }
    };
    
    // 🔥 重要：id がある場合は定義のみ（実行しない）
    if (node.id) {
      // appContext に context ノード自体を保存
      appContext["#" + node.id] = node;
      
      yield {
        phase: 'defined',
        node,
        data: { id: node.id },
        visual: { 
          label: `Context "${node.id}" defined (not executed)`,
          color: '#10B981',
          icon: '📝'
        }
      };
      
      // 子は実行しない！
      return node;
    }
    
    // 🔥 id がない場合は通常の実行
    if (node.child) {
      yield {
        phase: 'executing',
        node,
        visual: { 
          label: 'Executing context child',
          color: '#F59E0B'
        }
      };
      
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