// src/fx/nodes/collapse.ts
import type { FxNode, FxRef, ExecutionContext, ExecutionStep } from '../types';
import { drip } from '../../blooky-fp';
import { NodeDefinition } from '../NodeDefinition';
import { Dripper } from '../../blooky-types';
import { time } from '../../blooky-fx';

type ThisNode = Extract<FxNode, { type: 'collapse' }>;

export class CollapseNodeDefinition extends NodeDefinition<'collapse'> {
  public readonly type = 'collapse';

  public factory<A>(value: FxRef<A>, dripper: FxRef<Dripper<A>>, options?: {
      promise?: FxRef<"deny"|"allow"|"await">, 
      catcher?: FxRef<(v:Error) => unknown>,
    }): ThisNode {
    return { ...options, type: 'collapse', dripper, value };
  }

  public async *execute(context: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep> {
    const node = context.node;
    yield {
      phase: 'prepare',
      node,
      visual: { label: 'Preparing collapse', color: '#3B82F6' }
    };
    
    const value = context.resolve(node.value);
    const dripper = context.resolve(node.dripper);
    
    yield {
      phase: 'collapsing',
      node,
      data: { value: value(), dripper: dripper() },
      visual: { 
        label: 'Collapsing into stream',
        color: '#F59E0B',
        icon: '💧'
      }
    };
    await time.tick(drip(value())(dripper()));
    
    yield {
      phase: 'completed',
      node,
      visual: { label: 'Collapse completed', color: '#10B981' }
    };
  }
}