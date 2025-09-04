// src/blooky-fx/NodeDefinition.ts
import type { FxNode, FxExecutionContext, INodeDefinition } from './types';

/**
 * 全てのFxNode定義が継承すべき、抽象基底クラス
 */
export abstract class NodeDefinition<T extends FxNode['type']> implements INodeDefinition<T> {
  public abstract readonly type: T;
  public abstract factory(...args: any[]): Extract<FxNode, { type: T }>;
  public getChildNodes(node: Extract<FxNode, { type: T }>) : null | FxNode[] {
    return null;
  }
  public handle(context: FxExecutionContext & { node: Extract<FxNode, { type: T }> }): Promise<any> | any {
    throw new Error(`Node type "${this.type}" does not have a direct handler.`);
  }
  public *step({node}: FxExecutionContext & { node: Extract<FxNode, { type: T }>; }): Generator<FxNode, void, any> {
    yield node;
  }
}