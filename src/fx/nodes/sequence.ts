import type { INodeDefinition, FxNode, FxNodeCompiler } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'sequence' }>;

export class SequenceNodeDefinition extends NodeDefinition<'sequence'> {
  public readonly type = 'sequence';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'sequence', steps };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      steps: { value: node.steps.map(step => compiler.compileNode(step)) }
    });
  }
}