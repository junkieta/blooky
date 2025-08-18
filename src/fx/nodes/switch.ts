import type { FxNode, FxRef, FxNodeCompiler } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'switch' }>;

export class SwitchNodeDefinition extends NodeDefinition<'switch'> {
  public readonly type = 'switch';

  public factory(by: FxRef<any>, cases: Map<any, FxNode>, defaultNode?: FxNode): ThisNode {
    return { type: 'switch', by, cases, default: defaultNode };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    const compiledCases = new Map(
      Array.from(node.cases.entries()).map(([key, caseNode]) => 
        [key, compiler.compileNode(caseNode)]
      )
    );
    return Object.create(node, {
      by: { value: compiler.resolveValue(node.by) },
      cases: { value: compiledCases },
      default: { value: node.default ? compiler.compileNode(node.default) : undefined }
    });
  }

  // switch は run ジェネレータが処理するため、直接のhandleは不要
  public handle() {
    throw new Error("SwitchNode should be handled by the run generator.");
  }
}