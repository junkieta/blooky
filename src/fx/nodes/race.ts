// src/fx/nodes/race.ts
import type { CancelToken, ExecutionContext, FxNode, FxRaceNode, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { createCancelToken } from '../../blooky-fx';

type ThisNode = Extract<FxNode, { type: 'race' }>;

export class RaceNodeDefinition extends NodeDefinition<'race'> {
  public readonly type = 'race';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'race', steps };
  }

  public getChildNodes(node: FxRaceNode): FxNode[] {
    return node.steps;
  }

  public async *execute(context : ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
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
    
    // 各枝を spawn
    const branches = new Map<string, AsyncGenerator<ExecutionStep, any>>();
    
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
      const childCtx = {
        ...context,
        cancelToken: raceTokens[i]
      };
      branches.set(branchId, executeChild(node.steps[i]));
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
    
    // Promise.race で最初に完了したものを検出
    let winner: { id: string; result: any } | null = null;
    
    try {
      const racePromises = Array.from(branches.entries()).map(async ([id, gen]) => {
        let result;
        for await (const step of gen) {
          yield step; // 子の step を外に yield
          result = step;
        }
        return { id, result };
      });
      
      winner = await Promise.race(racePromises);
      
      yield {
        phase: 'winner',
        node,
        data: { winner: winner.id, result: winner.result },
        visual: { 
          label: `${winner.id} won the race!`,
          color: '#10B981',
          icon: '🏆'
        }
      };
    } finally {
      // 他の枝をキャンセル
      raceTokens.forEach(token => token.cancel());
      
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