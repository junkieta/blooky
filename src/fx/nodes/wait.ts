// src/fx/nodes/wait.ts
import type { FxRef, FxNote, ExecutionContext, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { when, type PromisedProp } from '../../blooky-fp';
import { Prop } from '../../blooky-types';

type ThisNode = Extract<FxNote, { type: 'wait' }>;

export class WaitNodeDefinition extends NodeDefinition<'wait'> {
  public readonly type = 'wait';

  public factory(options: { 
    ms?: FxRef<number>; 
    until?: FxRef<Prop<boolean> | PromisedProp<any>>; 
    id?: string;
  }): ThisNode {
    return { ...options, type: 'wait' };
  }

  public async *execute(context: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep> {
    const node = context.node;
    // 時間待機
    if (node.ms) {
      const ms = context.resolve(node.ms)();
      
      yield {
        phase: 'waiting',
        node,
        data: { ms },
        visual: { 
          label: `Waiting ${ms}ms...`, 
          color: '#F59E0B',
          icon: '⏱️'
        }
      };
      
      await new Promise(res => setTimeout(res, ms));
    }
    
    // 条件待機
    if (node.until) {
      yield {
        phase: 'waiting-condition',
        node,
        visual: { 
          label: 'Waiting for condition...', 
          color: '#F59E0B',
          icon: '⏳'
        }
      };
      
      const until = context.resolve<Prop<boolean> | PromisedProp<any>>(node.until);
      
      if ("then" in until) {
        await until;
      } else if (!until()) {
        await Promise.resolve(when(p => p === true)(until));
      }
    }
    
    yield {
      phase: 'completed',
      node,
      visual: { label: 'Wait completed', color: '#10B981' }
    };
  }
}