import type { FxRef, FxNode, FxExecutionContext } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { Prop, when } from '../../blooky-fp'; // when関数をインポート
type ThisNode = Extract<FxNode, { type: 'wait' }>;

export class WaitNodeDefinition extends NodeDefinition<'wait'> {
  public readonly type = 'wait';

  public factory(options: { ms?: FxRef<number>, until?: FxRef<Prop<boolean>>, id?: string }): ThisNode {
    return { ...options, type: 'wait' };
  }

  public async handle({ node,context }: FxExecutionContext & { node: ThisNode })  {
    const ms = context.resolve(node.ms);
    if (ms) {
      await new Promise(res => setTimeout(res, ms()));
    }
    if (node.until) {
      const until = context.resolve<Prop<boolean>>(node.until);
      await Promise.resolve(when(p => p === true)(until));
    }
  }
}