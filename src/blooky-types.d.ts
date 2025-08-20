// src/blooky-store/types.ts

import type { Prop, DripperEffect, DripperStream } from './blooky-fp';

/**
 * コミットのトリガーとなったdripの入力情報を記録する
 */
export interface DripTrigger<A> {
  dripper: DripperStream<A>;
  value: A;
}

/**
 * Gitの「コミット」に相当する、状態のスナップショット
 */
export interface StateSnapshot {
  id: string;                      // このスナップショットのユニークID (コミットハッシュ)
  parent: string | null;           // 親スナップショットのID
  trigger: DripTrigger<any>;       // このスナップショットを生成したトリガー
  effects: DripperEffect;          // このスナップショットを生成した差分情報 (git diff)
  fullState: Map<Prop<any>, any>;  // この時点での全Propの完全な状態
}

/**
 * Gitの「ブランチ」に相当する、スナップショットへのポインター
 */
export interface Branch {
  name: string;
  commitId: string; // このブランチが指し示すスナップショットのID
}