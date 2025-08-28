import type { FxNode, FxRef, FxExecutionContext } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'return' }>;

export const RETURN_VALUE = Symbol("RETURN_VALUE");
export class ReturnNodeDefinition extends NodeDefinition<'return'> {
  public readonly type = 'return';

  public factory(value: FxRef<any>): ThisNode {
    return { type: 'return', value };
  }

  public handle({node,context,appContext}: FxExecutionContext & { node: ThisNode }) {
    if(!(RETURN_VALUE in appContext)) {
      throw new Error("fx-return: This node must be called within a flow initiated by fx-yield.");
    }
    const value = context.resolve(node.value)();
    appContext[RETURN_VALUE](value);
    context.cancelToken.cancel();
    return value;
  }

}