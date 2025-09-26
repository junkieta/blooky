import type { FxNode, FxRef, FxExecutionContext} from '../types';
import { collapse, drip } from '../../blooky-fp';
import { NodeDefinition } from '../NodeDefinition';
import { DripperStream } from '../../blooky-types';
type ThisNode = Extract<FxNode, { type: 'collapse' }>;

export class CollapseNodeDefinition extends NodeDefinition<'collapse'> {
  public readonly type = 'collapse';

  public factory(value: FxRef<any>, dripper: FxRef<DripperStream<any>>, options?: {
      promise?: FxRef<"deny"|"allow"|"await">, 
      catcher?: FxRef<(v:Error) => unknown>,
    }): ThisNode {
    return { ...options, type: 'collapse', dripper, value };
  }

  public async handle({ node,context }: FxExecutionContext & { node: ThisNode }) {
    const value = context.resolve(node.value);
    const dripper = context.resolve(node.dripper);
    const acceptPromise = node.promise ? context.resolve(node.promise)() : 'deny';
    const result = await drip(value(), { acceptPromise })(dripper());
    await collapse(result);
  }
}