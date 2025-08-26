import type { INodeDefinition, FxNode, FxExecutionContext } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'sequence' }>;

export class SequenceNodeDefinition extends NodeDefinition<'sequence'> {
  public readonly type = 'sequence';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'sequence', steps };
  }

  public *step({ node, run }: FxExecutionContext & { node: ThisNode }): Generator<FxNode, void, any> {
    // 子ノードに対してrunを再帰的に呼び出す
    for (const stepNode of node.steps) {
      yield* run(stepNode);
    }
  }

}