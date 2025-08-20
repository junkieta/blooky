// src/blooky-fx/NodeDefinition.ts
import type { FxNode, FxCompiledNode, FxExecutionContext, INodeDefinition, FxNodeCompiler } from './types';

/**
 * 全てのFxNode定義が継承すべき、抽象基底クラス
 */
export abstract class NodeDefinition<T extends FxNode['type']> implements INodeDefinition<T> {
  public abstract readonly type: T;
  public abstract factory(...args: any[]): Extract<FxNode, { type: T }>;
  public abstract compile(node: Extract<FxNode, { type: T }>,compiler:FxNodeCompiler): Extract<FxCompiledNode, { type: T }>;

  public handle(context: FxExecutionContext & { node: Extract<FxCompiledNode, { type: T }> }): Promise<any> | any {
    throw new Error(`Node type "${this.type}" does not have a direct handler.`);
  }
}