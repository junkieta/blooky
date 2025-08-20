import type { INodeDefinition, FxNode, FxRef, FxNodeCompiler, FxExecutionContext, FxCompiledNode } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { resolve, Stream } from '../../blooky'; // blooky本体から resolve をインポート
type ThisNode = Extract<FxNode, { type: 'take' }>;
type ThisCompiledNode = Extract<FxCompiledNode, { type: 'take' }>;

export class TakeNodeDefinition extends NodeDefinition<'take'> {
  public readonly type = 'take';

  public factory(stream: FxRef<Stream<any>>, id?: string): ThisNode {
    return { type: 'take', stream, id };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      stream: { value: compiler.resolveValue(node.stream) }
    });
  }

  public handle({ node }: FxExecutionContext & { node: ThisCompiledNode }) {
    // resolveはPromiseを返すので、エンジンが自動的にawaitします
    return resolve(node.stream());
  }
}