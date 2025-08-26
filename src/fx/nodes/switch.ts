import type { FxExecutionContext, FxNode, FxRef, FxSwitchNode } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { Prop } from '../../blooky-fp';
type ThisNode = Extract<FxNode, { type: 'switch' }>;

export class SwitchNodeDefinition extends NodeDefinition<'switch'> {
  public readonly type = 'switch';

  public factory(by: FxRef<any>, cases: Map<any, FxNode>, defaultNode?: FxNode): ThisNode {
    return { type: 'switch', by, cases, default: defaultNode };
  }

  public *step({ node,run,context }: FxExecutionContext & { node: FxSwitchNode; }): Generator<FxNode, void, any> {
    const by = context.resolve(node.by)();
    if(node.cases.has(by))
      yield* run(node.cases.get(by)!);
    else if(node.default)
      yield* run(node.default);
  }

}