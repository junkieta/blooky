// src/fx/nodes/race.ts
import type { ExecutionContext, FxNote, FxRaceNode, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { createCancelToken } from '../../blooky-fx';

type ThisNode = Extract<FxNote, { type: 'race' }>;

export class RaceNodeDefinition extends NodeDefinition<'race'> {
  public readonly type = 'race';

  public factory(steps: FxNote[]): ThisNode {
    return { type: 'race', steps };
  }

  public getSubNotes(node: FxRaceNode): FxNote[] {
    return node.steps;
  }

  public async *execute(context: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
    const { node, executeChild } = context;
    yield {
      phase: 'init',
      node,
      data: { competitors: node.steps.length },
      visual: { 
        label: `Starting race (${node.steps.length} competitors)`,
        color: '#3B82F6'
      }
    };
    
    // 各枝用のキャンセルトークンを生成
    const raceTokens = node.steps.map(() => createCancelToken(context.cancelToken));
    
    // 各枝の generator を生成
    const branches = new Map<string, { gen: AsyncGenerator<ExecutionStep, any>, ctx: ExecutionContext }>();
    
    for (let i = 0; i < node.steps.length; i++) {
      yield {
        phase: 'spawn',
        node,
        data: { branchIndex: i, total: node.steps.length },
        visual: { 
          label: `Spawning competitor ${i + 1}/${node.steps.length}`,
          color: '#3B82F6',
          icon: '🏃'
        }
      };
      
      const branchId = `competitor-${i}`;
      branches.set(branchId, {
        gen: executeChild(node.steps[i]),
        ctx: { ...context, cancelToken: raceTokens[i] }
      });
    }
    
    yield {
      phase: 'racing',
      node,
      visual: { 
        label: 'Race in progress...', 
        color: '#F59E0B',
        icon: '🏁'
      }
    };
    
    // 協調的に各枝を実行（parallel と同じ方式）
    const results = new Map<string, any>();
    const pending = new Set(branches.keys());
    let winner: { id: string; result: any } | null = null;
    
    try {
      while (pending.size > 0 && !winner) {
        for (const [branchId, { gen }] of branches) {
          if (!pending.has(branchId)) continue;
          
          yield {
            phase: 'step-branch',
            node,
            data: { branchId, remaining: pending.size },
            visual: { 
              label: `Stepping ${branchId}`,
              color: '#F59E0B'
            }
          };
          
          const { value, done } = await gen.next();
          
          if (done) {
            // 最初に完了したものが勝者
            if (!winner) {
              winner = { id: branchId, result: value };
              
              yield {
                phase: 'winner',
                node,
                data: { winner: branchId, result: value },
                visual: { 
                  label: `${branchId} won the race!`,
                  color: '#10B981',
                  icon: '🏆'
                }
              };
              
              // 他の枝をキャンセル
              raceTokens.forEach((token, i) => {
                if (i !== parseInt(branchId.replace('competitor-', ''))) {
                  token.cancel();
                }
              });
            }
            
            results.set(branchId, value);
            pending.delete(branchId);
          } else if (value) {
            // 子の step を外に yield
            yield value;
          }
        }
      }
    } finally {
      yield {
        phase: 'cleanup',
        node,
        visual: { 
          label: 'Cancelling other competitors',
          color: '#6B7280'
        }
      };
    }
    
    yield {
      phase: 'completed',
      node,
      data: { winner: winner?.id, result: winner?.result },
      visual: { 
        label: 'Race completed', 
        color: '#10B981' 
      }
    };
    
    return winner?.result;
  }
}