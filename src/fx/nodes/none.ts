import type { FxNode, FxNodeCompiler } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'none' }>;

export class NoneNodeDefinition extends NodeDefinition<'none'> {
  public readonly type = 'none';

  public factory(): ThisNode {
    return { type: 'none' };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return node;
  }
}