// src/fx/nodes/yield.ts
import type { FxNode, FxRef, ExecutionContext, FxYieldNode, FxContextNode, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';
import { execute, isFxRef, prepare } from '../../blooky-fx';
import { RETURN_VALUE } from './return';
import { blooky } from '../../blooky-fp';

type ThisNode = Extract<FxNode, { type: 'yield' }>;

export class YieldNodeDefinition extends NodeDefinition<'yield'> {
  public readonly type = 'yield';

  public factory(options: { for: FxRef<FxContextNode>, value: FxRef<any>, id?: string }): ThisNode {
    return { type: 'yield', ...options };
  }

  public async *execute(context: ExecutionContext & { node: FxYieldNode }): AsyncGenerator<ExecutionStep, any> {
    const { node, appContext } = context;
    yield {
      phase: 'prepare',
      node,
      visual: { label: 'Preparing yield', color: '#3B82F6' }
    };
    
    const targetNode = context.resolve(node.for)();
    if (targetNode.type !== 'context') {
      throw blooky.error("flow", {
        code: "NOT_FOUND_YIELD_TARGET",
        message: `fx-yield: The target FxNode must be a 'context' node.`,
        nodeType: "yield",
        currentContext: JSON.stringify(appContext),
        requiredContext: isFxRef(node.for) ? (node.for as FxRef<any>).key : String(node.for)
      });
    }
    
    yield {
      phase: 'yielding',
      node,
      data: { target: targetNode.id },
      visual: { 
        label: 'Yielding to context',
        color: '#F59E0B',
        icon: '⤴️'
      }
    };
    
    const childNodeToRun = targetNode.child;
    const yieldedValue = node.value ? context.resolve(node.value)() : undefined;
    
    const result = await new Promise(async (resolve) => {
      appContext.$_ = yieldedValue;
      appContext[RETURN_VALUE] = resolve;
      const handle = execute(prepare(childNodeToRun, appContext, context));
      await handle.done;
    }).then((value) => {
      appContext.$_ = Symbol.for("NotResolved");
      appContext[RETURN_VALUE] = Symbol.for("NotResolved");
      return value;
    });
    
    yield {
      phase: 'completed',
      node,
      data: { result },
      visual: { label: 'Yield completed', color: '#10B981' }
    };
    
    return result;
  }
}