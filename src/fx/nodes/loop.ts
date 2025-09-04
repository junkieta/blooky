import type { FxExecutionContext, FxLoopNode, FxNode, FxRef } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'loop' }>;

export class LoopNodeDefinition extends NodeDefinition<'loop'> {
  public readonly type = 'loop';

  public factory(cond: FxRef<boolean>, body: FxNode): ThisNode {
    return { type: 'loop', cond, body };
  }

  public getChildNodes(node: FxLoopNode): null | FxNode[] {
    return [node.body];
  }

  public *step({ node,run,context }: FxExecutionContext & { node: FxLoopNode; }): Generator<FxNode, void, any> {
    const cond = context.resolve(node.cond);
    while (cond()) {
      yield* run(node.body);
    }
  }

}