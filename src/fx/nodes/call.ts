// src/blooky-fx/nodes/call.ts
import type { INodeDefinition, FxNode, FxRef, FxExecutionContext } from '../types';
import { NodeDefinition } from '../NodeDefinition';
type ThisNode = Extract<FxNode, { type: 'call' }>;
type ThisCompiledNode = Extract<FxNode, { type: 'call' }>;

/**
 * <fx-call> の全ての責務（ファクトリ、コンパイル、実行）をカプセル化するクラス
 */
export class CallNodeDefinition extends NodeDefinition<'call'> {
  public readonly type = 'call';

  /**
   * fx.call(...) のように呼び出されるファクトリメソッド
   */
  public factory(
    action: FxRef<(v: any) => unknown>,
    options?: { 
      arg?: FxRef<any>, 
      context?: FxRef<any>, 
      catcher?: FxRef<(v: Error) => unknown>, 
      id?: string 
    }
  ): ThisNode {
    return {
      ...options,
      type: 'call',
      action,
    };
  }

  /**
   * callノードを実行するハンドラ
   */
  public async handle({ node,context }: FxExecutionContext & { node: ThisNode }): Promise<any> {
    const actionFn = typeof node.action === "function" ? node.action : context.resolve(node.action) as (v:any)=>void;
    const contextObj = node.context ? context.resolve(node.context)() : undefined;
    const argValue = node.arg ? context.resolve(node.arg)() : undefined;
    return await actionFn.call(contextObj, argValue);
  }

}