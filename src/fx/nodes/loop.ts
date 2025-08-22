import type { FxNode, FxRef } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'loop' }>;

export class LoopNodeDefinition extends NodeDefinition<'loop'> {
  public readonly type = 'loop';

  public factory(cond: FxRef<boolean>, body: FxNode): ThisNode {
    return { type: 'loop', cond, body };
  }
}