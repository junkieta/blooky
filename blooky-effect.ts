// blooky-effect.ts
import type { Prop, Stream } from "./blooky";
import { drip, hold, listen } from "./blooky";

//
// 型定義
//
export type FxNode =
  | { type: "none" }
  | { type: "call", action: () => unknown }
  | { type: "sequence", steps: FxNode[] }
  | { type: "parallel", steps: FxNode[] }
  | { type: "wait", ms: number }
  | { type: "race", steps: FxNode[] }
  | { type: "loop", cond: Prop<boolean>, body: FxNode }
  | { type: "condition", if: Prop<boolean>, then: FxNode, else?: FxNode }
  | { type: "switch",
      by: Prop<string | number | symbol>, // 判断基準となるProp
      cases: Map<string | number | symbol, FxNode>, // 分岐先のMap
      default?: FxNode // defaultの分岐先
    }
  | { type: "drip", stream: Stream<any>, value: any }
  | { type: "take", stream: Stream<any> }

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
  none: (): FxNode => ({ type: "none" }),
  call: (action: () => unknown): FxNode => ({ type: "call", action }),
  sequence: (steps: FxNode[]): FxNode => ({ type: "sequence", steps }),
  parallel: (steps: FxNode[]): FxNode => ({ type: "parallel", steps }),
  race: (steps: FxNode[]): FxNode => ({ type: "race", steps }),
  wait: (ms: number): FxNode => ({ type: "wait", ms }),
  loop: (cond: Prop<boolean>, body: FxNode): FxNode => ({ type: "loop", cond, body }),
  condition: (
    cond: Prop<boolean>,
    thenBranch: FxNode,
    elseBranch?: FxNode
  ): FxNode => ({
    type: "condition",
    if: cond,
    then: thenBranch,
    else: elseBranch,
  }),
  switch: (
    by: Prop<any>,
    cases: Map<any, FxNode>,
    defaultNode?: FxNode
  ): FxNode => ({
    type: "switch",
    by,
    cases,
    default: defaultNode,
  }),  
  drip: <T>(stream: Stream<T>, value: T): FxNode => ({
    type: "drip",
    stream,
    value,
  }),
  take: <T>(stream: Stream<T>) : FxNode =>({
    type: "take",
    stream
  }),
  dispatch: (options: FxDispatchOptions, child?: FxNode): FxNode => {
    return fx.condition(() => {
      const e = new CustomEvent(options.name, {
        detail: options.detail ?? null,
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
      return target.dispatchEvent(e); // ← キャンセルされていない場合 true
    }, child ?? fx.none());
  },
};

/**
 * エフェクト実行エンジンが要求するコンテキストの機能。
 */
export interface IEffectContext {
  /**
   * 実行時の状態を書き込むためのメソッド。
   * @param state 実行状態を表すオブジェクト
   */
  setRuntimeState(state: { lastResult: any }): void;

  /**
   * コンテキストから値を取得するためのメソッド。
   * @param key 取得したい値のキー
   */
  getContextValue(key: string): any;
}

export type CancelToken = { cancel: () => void; cancelled: () => boolean };
export function createCancelToken(): CancelToken {
  let isCancelled = false;
  return {
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled,
  };
}


export function* run(node: FxNode): Generator<FxNode, void, any> {
  switch (node.type) {
    case "none":
      break;
    case 'sequence':
      for (const step of node.steps) {
        yield* run(step); // yield*で別のGeneratorに処理を委譲
      }
      break;
    default:
/* 
    case 'condition':
    case 'call':
    case 'delay':
    case 'drip':
    case 'switch':
    case 'take':
    case "parallel":
    case "race":
*/
      yield node; // executeの必要なノードはそのままyieldする
      break;
  }
}

export type FxHandlerArg<K extends FxNode["type"]> = {
  node: Extract<FxNode, { type: K }>
  context: IEffectContext
  token: CancelToken
  execute: typeof execute
  run: typeof run
}
export type FxHandlerMap = {
  [K in FxNode["type"]]: (args: FxHandlerArg<K>) => Promise<any>
}

export const fxHandlers: FxHandlerMap = {
  call: async ({ node }) => {
    return await node.action();
  },
  wait: async ({ node }) => {
    await new Promise(res => setTimeout(res, node.ms));
  },
  drip: async ({ node }) => {
    drip(node.stream)(node.value);
  },
  parallel: async ({ node, context, token, execute, run }) => {
    await Promise.all(node.steps.map(step =>
      execute(run(step), context, token)
    ));
  },
  race: async ({ node, context, token, execute, run }) => {
    const racers = node.steps.map(step => {
      const racerToken = createCancelToken();
      const combinedToken = {
        cancelled: () => token.cancelled() || racerToken.cancelled(),
        cancel: () => { token.cancel(); racerToken.cancel(); },
      };
      return {
        promise: execute(run(step), context, combinedToken),
        cancel: racerToken.cancel,
      };
    });
    try {
      await Promise.race(racers.map(r => r.promise));
    } finally {
      racers.forEach(r => r.cancel());
    }
  },
  take: async ({ node, token }) => {
    return await new Promise(resolve => {
      const uninitiarized = Symbol("uninit");
      const p = hold<any|typeof uninitiarized>(node.stream)(uninitiarized);
      const unsub = listen(p)(val => {
        unsub();
        resolve(val);
      });
      if (token.cancelled()) {
        unsub();
        resolve(undefined);
      }
    });
  },
  condition: async ({ node, context, token, execute, run }) => {
    const branch = node.if() ? node.then : node.else;
    if (branch) {
      await execute(run(branch), context, token);
    }
  },
  loop: async ({ node, context, token, execute, run }) => {
    while (!token.cancelled() && node.cond()) {
      await execute(run(node.body), context, token);
      await yieldToMainThread();
    }
  },
  switch: async ({ node, context, token, execute, run }) => {
    const key = node.by();
    const branch = node.cases.get(key) ?? node.default;
    if (branch) {
      await execute(run(branch), context, token);
    }
  },
  none: async () => {},
  sequence: async ({ node, context, token, execute, run }) => {
    for (const step of node.steps) {
      await execute(run(step), context, token);
    }
  },
};

export async function execute(
  generator: Generator<FxNode, void, any>,
  context: IEffectContext = {
    getContextValue:(key:string)=>context.hasOwnProperty(key) ? (context as IEffectContext & { [key:string]: any })[key] : undefined,
    setRuntimeState:(state)=>Object.assign(context,state)
  } as IEffectContext & { [key:string]: any },
  token: CancelToken = createCancelToken()
) {
  let result = generator.next();
  while (!result.done) {
    const node = result.value;
    const handler = fxHandlers[node.type] as (o:FxHandlerArg<typeof node.type>)=>void;
    if (!handler) throw new Error(`Unhandled FxNode type: ${node.type}`);
    const nextValue = await handler({ node, context, token, execute, run });
    context.setRuntimeState({ lastResult: nextValue });
    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  return { context, cancel: token.cancel };
}

/**
 * 現在の処理を一旦中断し、後続の処理を新しいマイクロタスクとして予約するPromiseを返す。
 * これにより、メインスレッドに一度処理を「譲る」ことができる。
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    queueMicrotask(resolve);
  });
}
