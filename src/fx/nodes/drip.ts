import type { INodeDefinition, FxNode, FxRef, FxNodeCompiler, FxExecutionContext, FxCompiledNode } from '../types';
import { drip, DripperStream } from '../../blooky';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'drip' }>;
type ThisCompiledNode = Extract<FxCompiledNode, { type: 'drip' }>;

export class DripNodeDefinition extends NodeDefinition<'drip'> {
  public readonly type = 'drip';

  public factory(stream: FxRef<DripperStream<any>>, value: FxRef<any>, options?: object): ThisNode {
    return { type: 'drip', stream, value, ...options };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      stream: { value: compiler.resolveValue(node.stream) },
      value: { value: compiler.resolveValue(node.value) },
      catcher: { value: node.catcher ? compiler.resolveAction(node.catcher) : undefined },
      mode: { value: node.mode ? compiler.resolveValue(node.mode) : undefined },
      promise: { value: node.promise ? compiler.resolveValue(node.promise) : undefined },
    });
  }

  public async handle({ node, execute }: FxExecutionContext & { node: ThisCompiledNode }) {
    try {
      const effect = await drip(node.value(), { acceptPromise: node.promise ? node.promise() : 'deny' })(node.stream());
      
      const mode = node.mode ? node.mode() : 'atomic';
      if (mode === 'atomic') {
        effect.forEach(({ update, nextValue }) => update(nextValue));
      } else { // 'saga' mode
        // 各Propの更新を独立した並列な副作用として実行
        const updateFlows = effect.map(({ update, nextValue }) => ({
          type: 'call' as const,
          action: () => update(nextValue) // update(nextValue) を返す関数
        }));
        await execute({ type: 'parallel', steps: updateFlows });
      }
    } catch (error) {
      if (node.catcher) {
        return node.catcher(error as Error);
      }
      throw error;
    }
  }
}