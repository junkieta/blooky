import type { FxRef, FxNode, FxExecutionContext } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { PromisedProp, when } from '../../blooky-fp'; // when関数をインポート
import { Prop } from '../../blooky-types';
type ThisNode = Extract<FxNode, { type: 'wait' }>;

export class WaitNodeDefinition extends NodeDefinition<'wait'> {
  public readonly type = 'wait';

  public factory(options: { ms?: FxRef<number>, until?: FxRef<Prop<boolean>|PromisedProp<any>>, id?: string }): ThisNode {
    return { ...options, type: 'wait' };
  }

  public async handle({ node,context }: FxExecutionContext & { node: ThisNode })  {
    const ms = context.resolve(node.ms);
    if (ms) {
      await new Promise(res => setTimeout(res, ms()));
    }
    if (!node.until) return;
    const until = context.resolve<Prop<boolean>|PromisedProp<any>>(node.until);
    if("then" in until)
      await until;
    else if(until())
      return;
    else
      await Promise.resolve(when(p => p === true)(until));
  }
}