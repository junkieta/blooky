import type { INodeDefinition, FxNode, FxRef, FxNodeCompiler, FxExecutionContext, FxCompiledNode, YieldRequest } from '../types';
import { drip } from '../../blooky';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'yield' }>;
type ThisCompiledNode = Extract<FxCompiledNode, { type: 'yield' }>;

export class YieldNodeDefinition extends NodeDefinition<'yield'> {
  public readonly type = 'yield';

  public factory(options: { for: string, value: FxRef<any>, id?: string }): ThisNode {
    return { type: 'yield', ...options };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
        for: { value: compiler.resolveValue(node.for) },
        value: { value: compiler.resolveValue(node.value) }
    });
  }

  public handle({ node, context }: FxExecutionContext & { node: ThisCompiledNode }) {
    // yieldのコアロジック: Promiseを使ってフローを一時停止させる
    return new Promise(resolve => {
      const yieldRequest: YieldRequest = {
        for: node.for,
        id: node.id,
        value: node.value(),
        resolve: resolve // ★応答用のコールバックを同梱
      };
      
      // 内部のyieldChannel$にリクエストをdripする
      const effect = drip(yieldRequest)(context.yieldChannel$);
      effect.forEach(e => e.update(e.nextValue));
    });
  }
}