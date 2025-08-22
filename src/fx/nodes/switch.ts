import type { FxNode, FxRef } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { Prop } from '../../blooky-fp';
type ThisNode = Extract<FxNode, { type: 'switch' }>;

export class SwitchNodeDefinition extends NodeDefinition<'switch'> {
  public readonly type = 'switch';

  public factory(by: FxRef<any>, cases: Map<any, FxNode>, defaultNode?: FxNode): ThisNode {
    return { type: 'switch', by, cases, default: defaultNode };
  }

}