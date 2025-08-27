import type { FxNode, FxRef, FxExecutionContext, YieldRequest, FxYieldNode, FxContextNode, FxResult } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { createProxyContext, execute, prepare } from '../engine';
type ThisNode = Extract<FxNode, { type: 'return' }>;

export class ReturnNodeDefinition extends NodeDefinition<'return'> {
  public readonly type = 'return';

  public factory(value: FxRef<any>): ThisNode {
    return { type: 'return', value };
  }

  public handle({node,context}: FxExecutionContext & { node: ThisNode; }) {
      return context.resolve(node.value)();
  }

}