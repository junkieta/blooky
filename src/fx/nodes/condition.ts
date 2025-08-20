import type { INodeDefinition, FxNode, FxRef, FxNodeCompiler } from '../types';
type ThisNode = Extract<FxNode, { type: 'condition' }>;
import { NodeDefinition } from '../NodeDefinition';

export class ConditionNodeDefinition extends NodeDefinition<'condition'> {
  public readonly type = 'condition';

  public factory(ifCond: FxRef<boolean>, thenBranch: FxNode, elseBranch?: FxNode): ThisNode {
    return { type: 'condition', if: ifCond, then: thenBranch, else: elseBranch };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      if: { value: compiler.resolveValue(node.if) },
      then: { value: compiler.compileNode(node.then) },
      else: { value: node.else ? compiler.compileNode(node.else) : undefined }
    });
  }
  
  // condition (if) は run ジェネレータが処理するため、直接のhandleは不要
  public handle() {
    throw new Error("ConditionNode should be handled by the run generator.");
  }
}