import type { FxNode, FxRef, FxExecutionContext } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { blooky } from '../../blooky-fp';
type ThisNode = Extract<FxNode, { type: 'return' }>;

export const RETURN_VALUE = Symbol("RETURN_VALUE");
export class ReturnNodeDefinition extends NodeDefinition<'return'> {
  public readonly type = 'return';

  public factory(value: FxRef<any>): ThisNode {
    return { type: 'return', value };
  }

  public handle({node,context,appContext}: FxExecutionContext & { node: ThisNode }) {
    if(!(RETURN_VALUE in appContext)) 
      throw blooky.error('flow', {
        code: 'INVALID_RETURN_CONTEXT',
        message: 'fx-return: This node must be called within a flow initiated by fx-yield',
        details: {
          requiredContext: 'fx-yield initiated flow',
          suggestions: ['Use fx-return only within fx-yield target flows']
        }
      });
    const value = context.resolve(node.value)();
    appContext[RETURN_VALUE](value);
    context.cancelToken.cancel();
    return value;
  }

}