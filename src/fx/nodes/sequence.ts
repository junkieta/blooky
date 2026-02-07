// src/fx/nodes/sequence.ts
import type { FxNote, FxSequenceNode, ExecutionContext, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNote, { type: 'sequence' }>;

export class SequenceNodeDefinition extends NodeDefinition<'sequence'> {
  public readonly type = 'sequence';

  public factory(steps: FxNote[]): ThisNode {
    return { type: 'sequence', steps };
  }

  public getSubNotes(node: FxSequenceNode): FxNote[] {
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
      
      // 子ノードの実行を委譲
      const childGen = executeChild(step);
      let childResult;
      
      // 🆕 generator の最終的な return 値を取得
      for await (const childStep of childGen) {
        yield childStep;
      }
      
      // 🆕 generator が完了した後、.next() で return 値を取得
      const finalResult = await childGen.next();
      childResult = finalResult.value;
      
      console.log('[sequence] Child completed', { 
        childIndex: i, 
        childId: step.id, 
        childResult 
      });
      
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