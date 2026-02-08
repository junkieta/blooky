// src/blooky-fx.ts

import { nodeDefinitionMap } from "./fx/nodes";
import { blooky } from "./blooky-fp";
import type { 
  FxNote, 
  AppContext, 
  CancelToken, 
  ExecContext, 
  ExecutionContext, 
  ExecutionHandle, 
  PreparedFx, 
  FxFactoryMap,
  ExecutionStep,
  FxRef,
  CancelReason
} from "./fx/types";
import type { Prop } from "./blooky-types";

// ─── 時間制御（旧 ft の内容）───
import { stream, collapse as coreCollapse, drip, DripEffect, hold } from './blooky-fp';
import { RETURN_VALUE } from "./fx/nodes/return";


// ─── FxNote ファクトリ ───
const fx = {} as FxFactoryMap;
nodeDefinitionMap.forEach((def, type) => {
  (fx as any)[type] = def.factory.bind(def);
});

// ─── FxRef 参照オブジェクト ───
const FxRefSymbol = Symbol("FxRef");
const ref = <T>(key: string): FxRef<T> => ({ [FxRefSymbol]: true, key });
const isFxRef = <T>(v: unknown): v is Extract<FxRef<T>, ({ [K in typeof FxRefSymbol]: true; } & { key: string; })> => 
  v && (v as any)[FxRefSymbol] === true;



// ─── resolveValue: FxRef を Prop に正規化 ───
const resolveValue = <T>(value: FxRef<T>) => (context: AppContext): Prop<T> => {
  if (isFxRef<T>(value)) { 
    value = context[value.key];
  }
  return typeof value === "function"
    ? value as Prop<T>
    : () => value as T;
}


export {
  fx, isFxRef, ref, resolveValue
};