import type { INodeDefinition, FxNode } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'sequence' }>;

export class SequenceNodeDefinition extends NodeDefinition<'sequence'> {
  public readonly type = 'sequence';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'sequence', steps };
  }

}