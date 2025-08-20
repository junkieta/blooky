import type { FxNode, FxRef, FxNodeCompiler, FxExecutionContext, FxCompiledNode } from '../types';
import { drip, DripperStream } from '../../blooky-fp';
import { NodeDefinition } from '../NodeDefinition';
import { fx } from '../engine';
type ThisNode = Extract<FxNode, { type: 'collapse' }>;
type ThisCompiledNode = Extract<FxCompiledNode, { type: 'collapse' }>;

export class CollapseNodeDefinition extends NodeDefinition<'collapse'> {
  public readonly type = 'collapse';

  public factory(value: FxRef<any>, dripper: FxRef<DripperStream<any>>, options?: {
      promise?: FxRef<"deny"|"allow"|"await">, 
      catcher?: FxRef<(v:Error) => unknown>,
      mode?: FxRef<"saga"|"atomic">
    }): ThisNode {
    return { ...options, type: 'collapse', dripper, value };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      stream: { value: compiler.resolveValue(node.dripper) },
      value: { value: compiler.resolveValue(node.value) },
      catcher: { value: node.catcher ? compiler.resolveAction(node.catcher) : undefined },
      mode: { value: node.mode ? compiler.resolveValue(node.mode) : undefined },
      promise: { value: node.promise ? compiler.resolveValue(node.promise) : undefined },
    });
  }

  public async handle({ node, execute }: FxExecutionContext & { node: ThisCompiledNode }) {
    try {
      const effect = await drip(node.value(), { acceptPromise: node.promise ? node.promise() : 'deny' })(node.stream()).effects;
      const mode = node.mode ? node.mode() : 'atomic';
      let _fx: FxNode;
      if (mode === 'atomic') {
        _fx = fx.call(()=>effect.forEach(({ update, nextValue }) => update(nextValue)));
      } else { // 'saga' mode
        // 各Propの更新を独立した並列な副作用として実行
        _fx = fx.parallel(effect.map(({update,nextValue})=>fx.call(update, { arg: nextValue })));
      }
      await execute(_fx);
    } catch (error) {
      if (node.catcher) {
        return node.catcher(error as Error);
      }
      throw error;
    }
  }
}