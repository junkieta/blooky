// src/blooky-store/types.ts

import type { Prop, DripperStream } from './blooky-fp';

/**
 * Gitの「ブランチ」に相当する、スナップショットへのポインター
 */
interface Branch {
  name: string;
  commitId: string; // このブランチが指し示すスナップショットのID
}

// Drip一回分のEffect
type DripEffect = {
  dripper: DripperStream<any>
  effects: Map<Prop<any>,any>;
}
// 各Propとその値を示す、最小のEffect。
type PropEffect<A> = [Prop<A>,A]

type DripResult<A,M="deny"> = M extends 'await'
  ? Promise<DripEffect>
  : DripEffect;
 
type Blueprint<A extends Object> = { [key in keyof A]: PropertyDescriptor };


export {
  DripEffect,DripperStream, PropEffect,DripResult,
  Branch,
  Blueprint
}