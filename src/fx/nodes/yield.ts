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
    
    // 🔥 修正：context から FxContextNode を取得
    let targetNode: FxContextNode;
    
    if (isFxRef(node.for)) {
      // ref の場合、appContext から取得
      const key = (node.for as FxRef<any>).key;
      console.log('[yield] Resolving context from appContext', { key, appContext });
      
      targetNode = appContext[key];
      
      if (!targetNode) {
        throw blooky.error("flow", {
          code: "CONTEXT_NOT_FOUND",
          message: `fx-yield: Context "${key}" not found in appContext`,
          nodeType: "yield",
          currentContext: Object.keys(appContext).join(', '),
          requiredContext: key,
          suggestions: ['Ensure fx-context with matching id is defined before fx-yield']
        });
      }
    } else {
      targetNode = context.resolve(node.for)();
    }
    
    console.log('[yield] Target node resolved', { targetNode });
    
    if (targetNode.type !== 'context') {
      throw blooky.error("flow", {
        code: "NOT_FOUND_YIELD_TARGET",
        message: `fx-yield: The target must be a 'context' node, got "${targetNode?.type}"`,
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
        label: `Yielding to context "${targetNode.id}"`,
        color: '#F59E0B',
        icon: '⤴️'
      }
    };
    
    const childNodeToRun = targetNode.child;
    const yieldedValue = node.value ? context.resolve(node.value)() : undefined;
    
    console.log('[yield] Executing context child', { childNodeToRun, yieldedValue });
    
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