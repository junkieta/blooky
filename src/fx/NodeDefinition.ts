// src/fx/NodeDefinition.ts
import type { FxNode, ExecutionContext, ExecutionStep, INodeDefinition } from './types';

/**
 * 全てのFxNode定義が継承すべき、抽象基底クラス
 */
export abstract class NodeDefinition<T extends FxNode['type']> implements INodeDefinition<T> {
  public abstract readonly type: T;
  
  /**
   * ファクトリ関数（fx.call(...) のような API）
   */
  public abstract factory(...args: any[]): Extract<FxNode, { type: T }>;
  
  /**
   * ノードを実行し、各段階を yield する
   */
  public abstract execute(
    ctx: ExecutionContext & { node: Extract<FxNode, { type: T }> }
  ): AsyncGenerator<ExecutionStep, any, any>;
  
  /**
   * ノードが持つ子ノードを返す（グラフ可視化用）
   * デフォルトは null（子を持たない）
   */
  public getChildNodes(node: Extract<FxNode, { type: T }>): null | FxNode[] {
    return null;
  }
}