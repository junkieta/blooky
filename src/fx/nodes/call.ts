// src/fx/nodes/call.ts
import type { FxNote, FxRef, ExecutionContext, ExecutionStep } from '../types';
import { NodeDefinition } from '../NodeDefinition';

type ThisNode = Extract<FxNote, { type: 'call' }>;

export class CallNodeDefinition extends NodeDefinition<'call'> {
  public readonly type = 'call';

  public factory(
    action: FxRef<(v: any) => unknown>,
    options?: { 
      arg?: FxRef<any>; 
      context?: FxRef<any>; 
      catcher?: FxRef<(v: Error) => unknown>; 
      id?: string;
    }
  ): ThisNode {
    return {
      ...options,
      type: 'call',
      action,
    };
  }

  public async *execute(context: ExecutionContext & { node: ThisNode }): AsyncGenerator<ExecutionStep, any> {
    const node = context.node;
    // Step 1: 準備
    yield {
      phase: 'prepare',
      node,
      visual: { label: 'Preparing function call', color: '#3B82F6' }
    };
    
    const actionFn = typeof node.action === "function" 
      ? node.action 
      : context.resolve(node.action);
    const contextObj = node.context ? context.resolve(node.context)() : undefined;
    const argValue = node.arg ? context.resolve(node.arg)() : undefined;
    
    // Step 2: 実行
    yield {
      phase: 'executing',
      node,
      data: { 
        fn: actionFn.name || 'anonymous', 
        arg: argValue,
        context: contextObj 
      },
      visual: { 
        label: `Calling ${actionFn.name || 'function'}()`, 
        color: '#F59E0B' 
      }
    };
    
    const result = await actionFn.call(contextObj, argValue);
    
    // Step 3: 完了
    yield {
      phase: 'completed',
      node,
      data: { result },
      visual: { label: 'Call completed', color: '#10B981' }
    };
    
    return result;
  }
}