import type { FxNode, FxRef, FxNodeCompiler, FxExecutionContext, FxCompiledNode } from '../types';
import { calendar, drip, DripperStream } from '../../blooky-fp';
import { NodeDefinition } from '../NodeDefinition';
import { fx } from '../engine';
import { DripResult } from '../../blooky-types';
type ThisNode = Extract<FxNode, { type: 'collapse' }>;
type ThisCompiledNode = Extract<FxCompiledNode, { type: 'collapse' }>;

export class CollapseNodeDefinition extends NodeDefinition<'collapse'> {
  public readonly type = 'collapse';

  public factory(value: FxRef<any>, dripper: FxRef<DripperStream<any>>, options?: {
      promise?: FxRef<"deny"|"allow"|"await">, 
      catcher?: FxRef<(v:Error) => unknown>,
    }): ThisNode {
    return { ...options, type: 'collapse', dripper, value };
  }

  public compile(node: ThisNode, compiler: FxNodeCompiler) {
    return Object.create(node, {
      stream: { value: compiler.resolveValue(node.dripper) },
      value: { value: compiler.resolveValue(node.value) },
      catcher: { value: node.catcher ? compiler.resolveAction(node.catcher) : undefined },
      promise: { value: node.promise ? compiler.resolveValue(node.promise) : undefined },
    });
  }

  public async handle({ node }: FxExecutionContext & { node: ThisCompiledNode }) {
    try {
      const acceptPromise = node.promise ? node.promise() : 'deny';
      const result =  drip(node.value(), { acceptPromise })(node.stream()) as DripResult<"deny">;
      if(acceptPromise === "await") result.effects = await result.effects;
      await calendar.schedule(result);
    } catch (error) {
      if (node.catcher) {
        return node.catcher(error as Error);
      }
      throw error;
    }
  }
}