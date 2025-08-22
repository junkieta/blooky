// src/blooky-store/types.ts

import type { Prop, DripperStream } from './blooky-fp';

/**
 * コミットのトリガーとなったdripの入力情報を記録する
 */
interface DripTrigger<A> {
  dripper: DripperStream<A>;
  value: A;
}

/**
 * Gitの「コミット」に相当する、状態のスナップショット
 */
interface StateSnapshot {
  id: string;                      // このスナップショットのユニークID (コミットハッシュ)
  parent: string | null;           // 親スナップショットのID
  trigger: DripTrigger<any>;       // このスナップショットを生成したトリガー
  effects: DripperEffect;          // このスナップショットを生成した差分情報 (git diff)
  fullState: Map<Prop<any>, any>;  // この時点での全Propの完全な状態
}

/**
 * Gitの「ブランチ」に相当する、スナップショットへのポインター
 */
interface Branch {
  name: string;
  commitId: string; // このブランチが指し示すスナップショットのID
}

type DripResult<A,M="deny"> = M extends 'await'
  ? Promise<{ effects: DripperEffect, trigger: DripTrigger<A> }>
  : { effects: DripperEffect, trigger: DripTrigger<A> };
 

// 副作用の集合体
type DripperEffect = PropEffect<unknown>[];

type PropEffect<A> = {
    created: number
    prop: Prop<A>
    nextValue: A
    prevValue: A
    update: ((v:A,prev:A)=>void)
}


export {
  DripperEffect,DripperStream, PropEffect,DripResult,
  Branch,StateSnapshot,DripTrigger,
}