import type { INodeDefinition, FxNode, FxRef, FxNodeCompiler } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'loop' }>;

export class LoopNodeDefinition extends NodeDefinition<'loop'> {
  public readonly type = 'loop';

  public factory(cond: FxRef<boolean>, body: FxNode): ThisNode {
    return { type: 'loop', cond, body };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      cond: { value: compiler.resolveValue(node.cond) },
      body: { value: compiler.compileNode(node.body) }
    });
  }
}