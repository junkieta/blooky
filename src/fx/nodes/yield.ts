import type { FxNode, FxRef, FxExecutionContext, YieldRequest, FxYieldNode, FxContextNode, FxResult } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { execute, prepare } from '../../blooky-fx';
import { RETURN_VALUE } from './return';
type ThisNode = Extract<FxNode, { type: 'yield' }>;

export class YieldNodeDefinition extends NodeDefinition<'yield'> {
  public readonly type = 'yield';

  public factory(options: { for: FxRef<FxContextNode>, value: FxRef<any>, id?: string }): ThisNode {
    return { type: 'yield', ...options };
  }

 public async handle({node,context,appContext}: FxExecutionContext & { node: FxYieldNode; }) {
    const targetNode = context.resolve(node.for)();
    if (targetNode.type !== 'context') {
      throw new Error(`fx-yield: The target FxNode must be a 'context' node.`);
    }
    const childNodeToRun = targetNode.child;
    const yieldedValue = node.value ? context.resolve(node.value)() : undefined;
    return await new Promise(async(resolve)=>{
      appContext.yieldedValue = yieldedValue;
      appContext[RETURN_VALUE] = resolve;
      const handle = execute(prepare(childNodeToRun, appContext, context));
      await handle.done;
    }).finally(()=>{
      appContext.yieldedValue =
      appContext[RETURN_VALUE] = Symbol.for("NotResolved");
    });

    /*
    return await new Promise(async(resolve)=>{
      const subAppContextBase = Object.assign({},appContext,targetNode.context,{yieldedValue,[RETURN_VALUE]:resolve});
      const handle = execute(prepare(childNodeToRun, subAppContextBase));
      await handle.done;
    });
    */
 }

}