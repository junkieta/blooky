// src/blooky-fx/nodes/call.ts
import type { INodeDefinition, FxNode, FxCompiledNode, FxNodeCompiler, FxRef } from '../types';
import { NodeDefinition } from '../NodeDefinition';

// 型を明確にするため、callノード専用の型を定義
type CallFxNode = Extract<FxNode, { type: 'call' }>;
type CallFxCompiledNode = Extract<FxCompiledNode, { type: 'call' }>;

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
  ): CallFxNode {
    return {
      ...options,
      type: 'call',
      action,
    };
  }

  /**
   * callノードをコンパイルするロジック
   */
  public compile(node: CallFxNode, compiler: FxNodeCompiler) {
    this.validateNode(node);

    return Object.create(node, {
      action: { value: compiler.resolveAction(node.action) },
      arg: { value: compiler.resolveValue(node.arg) },
      context: { value: compiler.resolveValue(node.context) },
      catcher: { 
        value: node.catcher ? compiler.resolveAction(node.catcher) : undefined 
      },
    }) as CallFxCompiledNode;
  }

  /**
   * callノードを実行するハンドラ
   */
  public async handle({ node }: { node: CallFxCompiledNode }): Promise<any> {
    const actionFn = node.action;
    const contextObj = node.context ? node.context() : undefined;
    const argValue = node.arg ? node.arg() : undefined;
    
    return await actionFn.call(contextObj, argValue);
  }

  /**
   * このクラス内だけで利用する、カプセル化されたプライベートメソッド
   */
  protected validateNode(node: CallFxNode): void {
    if (!node.action) {
      throw new Error('<fx-call> requires an "action" property.');
    }
  }

}