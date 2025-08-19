import type { FxNode, FxNodeCompiler } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'race' }>;

export class RaceNodeDefinition extends NodeDefinition<'race'> {
  public readonly type = 'race';

  public factory(steps: FxNode[]): ThisNode {
    return { type: 'race', steps };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      steps: { value: node.steps.map(step => compiler.compileNode(step)) }
    });
  }

  // raceはエンジン内のPromise.raceで処理されるため、直接のhandleは不要
  public handle() {
    throw new Error("RaceNode should be handled by the engine.");
  }
}