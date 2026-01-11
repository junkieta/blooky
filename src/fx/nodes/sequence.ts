// src/fx/nodes/sequence.ts
import type { FxNode, FxSequenceNode, ExecutionContext, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNode, { type: 'sequence' }>;

export class SequenceNodeDefinition extends NodeDefinition<'sequence'> {
  public readonly type = 'sequence';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'sequence', steps };
  }

  public getChildNodes(node: FxSequenceNode): FxNode[] {
    return node.steps;
  }

  public async *execute({ node, executeChild }: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
    yield {
      phase: 'init',
      node,
      data: { total: node.steps.length },
      visual: { 
        label: `Starting sequence (${node.steps.length} steps)`,
        color: '#3B82F6',
        progress: 0
      }
    };
    
    const results = [];
    
    for (let i = 0; i < node.steps.length; i++) {
      const step = node.steps[i];
      
      yield {
        phase: 'executing-child',
        node,
        data: { childIndex: i, child: step, total: node.steps.length },
        visual: { 
          label: `Step ${i + 1}/${node.steps.length}`,
          color: '#F59E0B',
          progress: i / node.steps.length
        }
      };
      
      // 子ノードの実行を委譲（子の各 yield も外に伝播）
      const childGen = executeChild(step);
      let childResult;
      for await (const childStep of childGen) {
        // 子の step を外に yield（デバッガが観測可能）
        yield childStep;
        childResult = childStep;
      }
      results.push(childResult);
    }
    
    yield {
      phase: 'completed',
      node,
      data: { results },
      visual: { 
        label: 'Sequence completed', 
        color: '#10B981',
        progress: 1 
      }
    };
    
    return results;
  }
}