import type { INodeDefinition, FxRef, FxNode, FxNodeCompiler } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { when } from '../../blooky'; // when関数をインポート
type ThisNode = Extract<FxNode, { type: 'wait' }>;

export class WaitNodeDefinition extends NodeDefinition<'wait'> {
  public readonly type = 'wait';

  public factory(options: { ms?: FxRef<number>, until?: FxRef<boolean> }): ThisNode {
    return { type: 'wait', ...options };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      ms: { value: node.ms ? compiler.resolveValue(node.ms) : undefined },
      until: { value: node.until ? compiler.resolveValue(node.until) : undefined },
    });
  }

  public async handle({ node }) {
    if (node.ms) {
      await new Promise(res => setTimeout(res, node.ms()));
    }
    if (node.until) {
      // until属性で指定されたPropがtrueになるのを待つ
      await when(p => p === true)(node.until);
    }
  }
}