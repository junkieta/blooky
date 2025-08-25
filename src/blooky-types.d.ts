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
  effects: PropEffect<any>[];          // このスナップショットを生成した差分情報 (git diff)
  fullState: Map<Prop<any>, any>;  // この時点での全Propの完全な状態
}

/**
 * Gitの「ブランチ」に相当する、スナップショットへのポインター
 */
interface Branch {
  name: string;
  commitId: string; // このブランチが指し示すスナップショットのID
}

// 副作用の集合体
type DripEffect<A> = {
  effects: PropEffect<unknown>[]
  trigger: DripTrigger<A>
};

type PropEffect<A> = {
    created: number
    prop: Prop<A>
    nextValue: A
    prevValue: A
    update: ((v:A,prev:A)=>void)
}

type DripResult<A,M="deny"> = M extends 'await'
  ? Promise<DripEffect<A>>
  : DripEffect<A>;
 

export {
  DripEffect,DripperStream, PropEffect,DripResult,
  Branch,StateSnapshot,DripTrigger,
}