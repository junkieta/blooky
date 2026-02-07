// src/fx/nodes/parallel.ts
import type { FxNote, FxParallelNode, ExecutionContext, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNote, { type: 'parallel' }>;

export class ParallelNodeDefinition extends NodeDefinition<'parallel'> {
  public readonly type = 'parallel';

  public factory(steps: FxNote[]): ThisNode {
    return { type: 'parallel', steps };
  }

  public getSubNotes(node: FxParallelNode): FxNote[] {
    return node.steps;
  }

  public async *execute({ node, executeChild }: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
    // Step 1: 初期化
    yield {
      phase: 'init',
      node,
      data: { branches: node.steps.length },
      visual: { 
        label: `Starting parallel (${node.steps.length} branches)`,
        color: '#3B82F6'
      }
    };
    
    // Step 2: 各枝を spawn
    const branches = new Map<string, AsyncGenerator<ExecutionStep, any>>();
    
    for (let i = 0; i < node.steps.length; i++) {
      yield {
        phase: 'spawn',
        node,
        data: { branchIndex: i, total: node.steps.length },
        visual: { 
          label: `Spawning branch ${i + 1}/${node.steps.length}`,
          color: '#3B82F6',
          icon: '🌿'
        }
      };
      
      const branchId = `branch-${i}`;
      branches.set(branchId, executeChild(node.steps[i]));
    }
    
    // Step 3: 協調的に実行（ラウンドロビン）
    yield {
      phase: 'running',
      node,
      data: { branches: branches.size },
      visual: { 
        label: 'Running branches cooperatively', 
        color: '#F59E0B'
      }
    };
    
    const results = new Map<string, any>();
    const pending = new Set(branches.keys());
    
    while (pending.size > 0) {
      for (const [branchId, gen] of branches) {
        if (!pending.has(branchId)) continue;
        
        yield {
          phase: 'step-branch',
          node,
          data: { 
            branchId, 
            remaining: pending.size,
            completed: branches.size - pending.size
          },
          visual: { 
            label: `Stepping ${branchId}`,
            color: '#F59E0B',
            progress: (branches.size - pending.size) / branches.size
          }
        };
        
        const { value, done } = await gen.next();
        
        if (done) {
          results.set(branchId, value);
          pending.delete(branchId);
          
          yield {
            phase: 'branch-completed',
            node,
            data: { branchId, result: value },
            visual: { 
              label: `${branchId} completed`, 
              color: '#10B981',
              icon: '✓'
            }
          };
        } else {
          // 子の step を外に yield
          yield value;
        }
      }
    }
    
    // Step 4: 完了
    yield {
      phase: 'completed',
      node,
      data: { results: Array.from(results.values()) },
      visual: { 
        label: 'All branches completed', 
        color: '#10B981',
        progress: 1 
      }
    };
    
    return Array.from(results.values());
  }
}