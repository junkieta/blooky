// src/blooky-fx.ts

import { nodeDefinitionMap } from "./fx/nodes";
import type { 
  FxRefSymbol as FxRefSymbolType,
  FxNote, 
  AppContext, 
  CancelToken, 
  ExecContext, 
  ExecutionContext, 
  ExecutionHandle, 
  PreparedFx, 
  FxFactoryMap,
  ExecutionStep,
  CancelReason,
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
export const FxRefSymbol: typeof FxRefSymbolType = Symbol("FxRef") as typeof FxRefSymbolType;

export type FxRefKey<T> = {
  readonly [FxRefSymbol]: true;
  readonly key: string;
};

export type FxRef<T> = FxRefKey<T> | Prop<T> | T;


const ref = <T>(key: string): FxRefKey<T> =>
  ({ [FxRefSymbol]: true, key } as const);

const isFxRefKey = <T>(v: unknown): v is FxRefKey<T> =>
  !!v && typeof v === "object" && (v as any)[FxRefSymbol] === true;
// ─── resolveValue: FxRef を Prop に正規化 ───
const resolveValue = <T>(value: FxRef<T>) => (context: AppContext): Prop<T> => {
  if (isFxRefKey<T>(value)) { 
    value = context[value.key];
  }
  return typeof value === "function"
    ? value as Prop<T>
    : () => value as T;
}


export {
  fx, isFxRefKey as isFxRef, ref, resolveValue
};