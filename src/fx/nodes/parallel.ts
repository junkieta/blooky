import type { FxNode, FxNodeCompiler } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'parallel' }>;

export class ParallelNodeDefinition extends NodeDefinition<'parallel'> {
  public readonly type = 'parallel';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'parallel', steps };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      steps: { value: node.steps.map(step => compiler.compileNode(step)) }
    });
  }

  // parallelはエンジン内のPromise.allで処理されるため、直接のhandleは不要
  public handle() {
    throw new Error("ParallelNode should be handled by the engine.");
  }
}