// blooky-effect.ts
import type { Prop, Stream } from "./blooky";
import { drip } from "./blooky";
import { FxContextInterface, FxContextInternalInterface, FxContextObject } from "./blooky-context";

//
// 型定義
//

export type FxNode =
  | { type: "none" }
  | { type: "call", action: () => unknown }
  | { type: "sequence", steps: FxNode[] }
  | { type: "parallel", steps: FxNode[] }
  | { type: "delay", ms: number }
  | { type: "race", steps: FxNode[] }
  | { type: "condition", if: () => boolean, then: FxNode, else?: FxNode }
  | { type: "drip", stream: Stream<any>, value: any };

export type FxDispatchOptions = {
  name: string;
  target: string|EventTarget;
  detail?: any;
  bubbles?: boolean;
  composed?: boolean;
  cancelable?: boolean;
};

export type FxResolvable = Prop<any> | Stream<any>;


//
// DSL（ファクトリ）
//

export const fx = {
  call: (action: () => unknown): FxNode => ({ type: "call", action }),
  sequence: (steps: FxNode[]): FxNode => ({ type: "sequence", steps }),
  parallel: (steps: FxNode[]): FxNode => ({ type: "parallel", steps }),
  delay: (ms: number): FxNode => ({ type: "delay", ms }),
  race: (steps: FxNode[]): FxNode => ({ type: "race", steps }),
  none: (): FxNode => ({ type: "none" }),
  condition: (
    cond: () => boolean,
    thenBranch: FxNode,
    elseBranch?: FxNode
  ): FxNode => ({
    type: "condition",
    if: cond,
    then: thenBranch,
    else: elseBranch,
  }),
  drip: <T>(stream: Stream<T>, value: T): FxNode => ({
    type: "drip",
    stream,
    value,
  }),
  dispatch: (options: FxDispatchOptions, child?: FxNode): FxNode => {
    return fx.condition(() => {
      const e = new CustomEvent(options.name, {
        detail: options.detail ?? {},
        bubbles: options.bubbles ?? true,
        composed: options.composed ?? true,
        cancelable: options.cancelable ?? false
      });

      let target : EventTarget | null;

      if(options.target instanceof EventTarget) {
        target = options.target;
      }
      else switch(options.target) {
        case undefined:
        case null:
        case "_document":
          target = document; break;
        case "_window":
          target = window; break;
        default:
          target = document.getElementById(options.target);
          break;
      }

      if(!target) {
        throw new Error("not found fx-dispatch target");
      }
       
      const accepted = target.dispatchEvent(e);
      return accepted; // ← キャンセルされていない場合 true
    }, child ?? fx.none());
  },
};


type CancelToken = {
  cancel: () => void;
  cancelled: () => boolean
};

export function createCancelToken(): CancelToken {
  let isCancelled = false;
  return {
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled,
  };
}


export function runCancelable(
  node: FxNode,
  context: FxContextInternalInterface = new FxContextObject(),
  token = createCancelToken()
) : {
  promise: Promise<void>,
  cancel: () => void,
  context: FxContextInternalInterface
} {
  const promise = (async function(n: FxNode): Promise<void> {
    if (token.cancelled()) return;

    switch (n.type) {

      case "none":
        break;

      case "call":
        const result = await n.action();
        context.set("result", result);
        break;

      case "drip":
        context.set("lastDrip", drip(n.stream)(n.value));
        break;

      case "delay":
        const delayPromise = new Promise(resolve => setTimeout(resolve, n.ms));
        const cancelPromise = new Promise((_, reject) => {
            const check = () => {
                if (token.cancelled()) {
                    reject(new Error("Cancelled")); // キャンセルされたら即座にPromiseをreject
                } else {
                    // requestAnimationFrameや短いsetTimeoutで定期的にチェック
                    requestAnimationFrame(check); 
                }
            };
            check();
        });
        await Promise.race([delayPromise, cancelPromise]);
        break;

      case "sequence":
        for (const step of n.steps) {
          await runCancelable(step, context).promise;
          if (token.cancelled()) return;
        }
        break;

      case "parallel":
        await Promise.all(n.steps.map((step) => runCancelable(step, context, token).promise));
        break;

      case "race":
        await Promise.race(n.steps.map((step) => runCancelable(step, context, token).promise));
        break;

      case "condition":
        const branch = n.if() ? n.then : n.else;
        if (branch) await runCancelable(branch, context);
        break;
        
    }
  })(node);

  return { promise, cancel: token.cancel, context };
}