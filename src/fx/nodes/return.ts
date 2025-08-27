import type { FxNode, FxRef, FxExecutionContext } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'return' }>;

export class ReturnNodeDefinition extends NodeDefinition<'return'> {
  public readonly type = 'return';

  public factory(value: FxRef<any>): ThisNode {
    return { type: 'return', value };
  }

  public handle({node,context,appContext}: FxExecutionContext & { node: ThisNode }) {
    const value = context.resolve(node.value)();
    appContext.returnValue(value);
    context.cancelToken.cancel();
    return value;
  }
  /*
  public *step({ node,context }: FxExecutionContext & { node: ThisNode }): Generator<FxNode, void, any> {
    const value = context.resolve(node.value)();
    return value;
  }
  */

}