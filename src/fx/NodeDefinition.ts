// src/fx/NodeDefinition.ts
import type { FxNote, ExecutionContext, ExecutionStep, INodeDefinition } from './types';

/**
 * 全てのFxNote定義が継承すべき、抽象基底クラス
 */
export abstract class NodeDefinition<T extends FxNote['type']> implements INodeDefinition<T> {
  public abstract readonly type: T;
  
  /**
   * ファクトリ関数（fx.call(...) のような API）
   */
  public abstract factory(...args: any[]): Extract<FxNote, { type: T }>;
  
  /**
   * ノードを実行し、各段階を yield する
   */
  public abstract execute(
    ctx: ExecutionContext & { node: Extract<FxNote, { type: T }> }
  ): AsyncGenerator<ExecutionStep, any, any>;
  
  /**
   * ノードが持つ子ノードを返す（グラフ可視化用）
   * デフォルトは null（子を持たない）
   */
  public getSubNotes(node: Extract<FxNote, { type: T }>): null | FxNote[] {
    return null;
  }
}