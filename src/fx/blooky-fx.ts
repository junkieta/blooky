// blooky-effect.ts
import { DripperStream, isChainedProp, Prop, proxy, Stream } from "../blooky";
import { accum, drip, hold, resolve, stream } from "../blooky";
import { FxNode, FxCompiledNode, AppContext, CancelToken, ExecContext, FxDispatchSettings, FxExecutionContext, FxHandlerMap, FxMiddleware } from "./types";


//
// DSL（ファクトリ）
//
const fx = {
  none: (): FxNode => ({ type: "none" }),
  call: (action: FxRef<(v:any) => unknown>, options?: { arg?: FxRef<any>, context?: FxRef<any>, catcher?: FxRef<(v:Error) => unknown>, id?: string }): FxNode => ({
    ...options,
    type: "call",
    action,
  }),
  sequence: (steps: FxNode[]): FxNode => ({ type: "sequence", steps }),
  parallel: (steps: FxNode[]): FxNode => ({ type: "parallel", steps }),
  race: (steps: FxNode[]): FxNode => ({ type: "race", steps }),
  wait: (ms: FxRef<number>): FxNode => ({ type: "wait", ms }),
  loop: (cond: FxRef<boolean>, body: FxNode): FxNode => ({ type: "loop", cond, body }),
  condition: (
    cond: FxRef<boolean>,
    thenBranch: FxNode,
    elseBranch?: FxNode
  ): FxNode => ({
    type: "condition",
    if: cond,
    then: thenBranch,
    else: elseBranch,
  }),
  switch: (
    by: FxRef<any>,
    cases: Map<any, FxNode>,
    defaultNode?: FxNode
  ): FxNode => ({
    type: "switch",
    by,
    cases,
    default: defaultNode,
  }),  
  drip: <T>(
    value: FxRef<T>,
    stream: FxRef<DripperStream<T>>, 
    options?: {
      promise?: FxRef<"deny"|"allow"|"await">, 
      catcher?: FxRef<(v:Error) => unknown>,
      mode?: FxRef<"saga"|"atomic">
    }): FxNode => ({
    ...options,
    type: "drip",
    stream,
    value,
  }),
  take: <T>(stream: FxRef<Stream<T>>, id?: string) : FxNode =>({
    type: "take",
    stream,
    id
  }),
  dispatch: <T>(name:string, settings: FxDispatchSettings<T>, child?: FxNode): FxNode => {
    return {
      type: "dispatch",
      name,
      settings,
      child
    };
  },
  yield: <T>(value:FxRef<T>, id:string): FxNode =>({ type: "yield", value, id }),
};



/**
 * 現在の処理を一旦中断し、後続の処理を新しいマイクロタスクとして予約するPromiseを返す。
 * これにより、メインスレッドに一度処理を「譲る」ことができる。
 */
function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    queueMicrotask(resolve);
  });
}
