import type { FxNode, FxRef, FxExecutionContext} from '../types';
import { drip } from '../../blooky-fp';
import { NodeDefinition } from '../NodeDefinition';
import { Dripper } from '../../blooky-types';
import { collapse } from '../../blooky-ft';
type ThisNode = Extract<FxNode, { type: 'collapse' }>;

export class CollapseNodeDefinition extends NodeDefinition<'collapse'> {
  public readonly type = 'collapse';

  public factory<A>(value: FxRef<A>, dripper: FxRef<Dripper<A>>, options?: {
      promise?: FxRef<"deny"|"allow"|"await">, 
      catcher?: FxRef<(v:Error) => unknown>,
    }): ThisNode {
    return { ...options, type: 'collapse', dripper, value };
  }

  public async handle({ node,context }: FxExecutionContext & { node: ThisNode }) {
    const value = context.resolve(node.value);
    const dripper = context.resolve(node.dripper);
    await collapse(drip(value())(dripper()));
  }
}