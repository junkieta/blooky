// src/blooky-store/types.ts

import type { Prop, DripperStream } from './blooky-fp';

/**
 * Gitの「ブランチ」に相当する、スナップショットへのポインター
 */
interface Branch {
  name: string;
  commitId: string; // このブランチが指し示すスナップショットのID
}

// 副作用の集合体
type DripEffect = PropEffect<any>[]

type PropEffect<A> = {
    prop: Prop<A>
    nextValue: A
    prevValue: A
} 

type DripResult<A,M="deny"> = M extends 'await'
  ? Promise<DripEffect>
  : DripEffect;
 

export {
  DripEffect,DripperStream, PropEffect,DripResult,
  Branch,
}