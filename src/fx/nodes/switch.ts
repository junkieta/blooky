import type { FxNode, FxRef, FxNodeCompiler } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { Prop } from '../../blooky-fp';
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

}