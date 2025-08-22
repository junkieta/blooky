import type { FxNode, FxRef, FxExecutionContext, YieldRequest } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'yield' }>;
type ThisCompiledNode = Extract<FxNode, { type: 'yield' }>;

export class YieldNodeDefinition extends NodeDefinition<'yield'> {
  public readonly type = 'yield';

  public factory(options: { for: string, value: FxRef<any>, id?: string }): ThisNode {
    return { type: 'yield', ...options };
  }

  public handle({ node, context }: FxExecutionContext & { node: ThisCompiledNode }) {
    // yieldのコアロジック: Promiseを使ってフローを一時停止させる
    return new Promise((resolve,reject) => {
      // 1. このPromiseを外部から中断できるように、reject関数を登録する
      context.pendingYieldReject = reject;
      const yieldRequest: YieldRequest = {
        for: context.resolve(node.for)(),
        id: node.id,
        value: context.resolve(node.value)(),
        resolve: resolve // 応答用のコールバックを同梱
      };
      // 登録されているハンドラ（連絡先）があれば、直接リクエストを渡す
      if (context.yieldChannel) {
        context.yieldChannel(yieldRequest);
      } else {
        // 誰もfetch()で待っていなかった場合。フローを止めるのが安全
        reject(new Error("fx.yield was called, but no consumer was available via fetch()."));
      }
      if(context.cancelToken.cancelled()) reject();
    }).finally(() => {
      // 2. Promiseが解決・拒否されたら、必ず登録を解除してクリーンアップ
      context.pendingYieldReject = undefined;
    });
  }
}