// blooky-effect.ts
import type { DripperStream, Prop, Stream } from "./blooky";
import { drip, resolve } from "./blooky";

//
// 型定義
//
export type FxNodeBase<T extends string, P = {}> = P & {
  type: T
  id?: string
};

export type FxNode =
  | FxNodeBase<"none">
  | FxNodeBase<"sequence", { steps: FxNode[] }>
  | FxNodeBase<"parallel", { steps: FxNode[] }>
  | FxNodeBase<"race", { steps: FxNode[] }>
  | FxNodeBase<"wait", { ms: number }>
  | FxNodeBase<"loop", {
      cond: Prop<boolean>,
      body: FxNode
    }>
  | FxNodeBase<"condition", {
      if: Prop<boolean>,
      then: FxNode,
      else?: FxNode
    }>
  | FxNodeBase<"switch", {
      by: Prop<string | number | symbol>,
      cases: Map<string | number | symbol, FxNode>,
      default?: FxNode
    }>
  | FxNodeBase<"call", {
      action: () => unknown,
      catcher?: (error: Error) => unknown
    }>
  | FxNodeBase<"drip", {
      stream: DripperStream<any>,
      value: Prop<any>,
      catcher?: (error: Error) => unknown,
      mode: "saga" | "atomic"
    }>
  | FxNodeBase<"dispatch", {
      name: string,
      settings: FxDispatchSettings<any>,
      child?: FxNode
    }>
  | FxNodeBase<"take", {
      stream: Stream<any>
    }>

export type FxDispatchSettings<A> = CustomEventInit<Prop<A>> & {
  target: string|EventTarget;
};

//
// DSL（ファクトリ）
//
export const fx = {
  none: (): FxNode => ({ type: "none" }),
  call: (action: () => unknown, catcher?: (v:Error) => unknown, id?: string): FxNode => ({ type: "call", action, catcher, id }),
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
  drip: <T>(value: Prop<T>, stream: DripperStream<T>, catcher?: (v:Error) => unknown, mode : "saga"|"atomic" = "saga"): FxNode => ({
    type: "drip",
    stream,
    value,
    catcher,
    mode
  }),
  take: <T>(stream: Stream<T>, id?: string) : FxNode =>({
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
};

/**
 * エフェクト実行エンジンが要求するコンテキストの機能。
 */
export interface IEffectContext {

  /**
   * 実行時の状態を書き込むためのメソッド。
   * @param state 実行状態を表すオブジェクト
   */
  setRuntimeState(state: { [key:string]: any, lastResult: any }): void;

  /**
   * コンテキストから値を取得するためのメソッド。
   * @param key 取得したい値のキー
   */
  getContextValue(key: string): any;

  onNodeEnter?: (node: FxNode) => void
  onNodeExit?: (node: FxNode, result?: any, error?: Error) => void

}

export type CancelToken = { cancel: () => void; cancelled: () => boolean };
export function createCancelToken(): CancelToken {
  let isCancelled = false;
  return {
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled,
  };
}


export type FxHandlerArg<K extends FxNode["type"]> = {
  node: Extract<FxNode, { type: K }>
  context: IEffectContext
  token: CancelToken
  execute: typeof execute
  run: typeof run
}

export type FxHandlerMap = {
  [K in FxNode["type"]]?: (args: FxHandlerArg<K>) => Promise<any>
}

export const fxHandlers: FxHandlerMap = {
  call: async ({ node }) => await node.action(),
  wait: async ({ node }) => await new Promise(res => setTimeout(res, node.ms)),
  drip: async ({ node,context,run,execute,token }) => {
    const catcher = node.catcher;
    const effect = drip(node.value())(node.stream);
    const _fx = node.mode === "atomic"
      ? fx.call(()=>effect.forEach(({update,nextValue})=>update(nextValue)), catcher)
      : fx.parallel(effect.map(({update,nextValue})=>fx.call(()=>update(nextValue), catcher)));
    await execute(run(_fx, context), context, token);
  },
  dispatch: async ({node,context,execute,run,token}) => {
    const settings = node.settings;
    const e = new CustomEvent(node.name, settings);

    let target : EventTarget;
    if(settings.target instanceof EventTarget) {
      target = settings.target;
    }
    else switch(settings.target) {
      case undefined:
      case null:
      case "_document":
        target = document; break;
      case "_window":
        target = window; break;
      default:
        const element = document.getElementById(settings.target);
        if(element) {
          target = element;
        } else {
          console.warn("not found fx-dispatch target");
          target = document;
        }
        break;
    }
    if(target.dispatchEvent(e) && node.child)
        await execute(run(node.child, context), context, token);
  },
  take: async ({ node }) => await resolve(node.stream),
  parallel: async ({ node, context, token, execute, run }) => {
    // node.stepsに含まれる各フローに対して、executeを並列で実行する
    await Promise.all(
      node.steps.map(step => execute(run(step, context), context, token))
    );
  },
  race: async ({ node, context, token, execute, run }) => {
    // 各レーサー（ステップ）に、個別にキャンセル可能なトークンを用意する
    const racers = node.steps.map(step => {
      const racerToken = createCancelToken();
      // メインのtokenか、個別tokenのどちらかがキャンセルされたらキャンセルとみなす
      const combinedToken = {
        cancelled: () => token.cancelled() || racerToken.cancelled(),
        cancel: () => { token.cancel(); racerToken.cancel(); },
      };
      return {
        promise: execute(run(step, context), context, combinedToken),
        cancel: racerToken.cancel,
      };
    });

    try {
      // Promise.raceで、最初に完了したフローを待つ
      await Promise.race(racers.map(r => r.promise));
    } finally {
      // レース終了後、勝者以外の全てのレーサーをキャンセルする
      racers.forEach(r => r.cancel());
    }
  },  
};


/**
 * 現在の処理を一旦中断し、後続の処理を新しいマイクロタスクとして予約するPromiseを返す。
 * これにより、メインスレッドに一度処理を「譲る」ことができる。
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    queueMicrotask(resolve);
  });

}

// Middlewareに渡されるコンテキスト情報
export type FxExecutionContext = {
  node: FxNode;
  context: IEffectContext;
  token: CancelToken;
  run: typeof run;
  execute: typeof execute;
  // このコンテキストで実行されるべきコアの処理
  handler: (args: FxHandlerArg<any>) => Promise<any>; 
};

// Middlewareの関数型
export type FxMiddleware = (
  ctx: FxExecutionContext,
  next: () => Promise<any> // 次のMiddlewareを呼び出すための関数
) => Promise<any>;

export function* run(node: FxNode, context: IEffectContext): Generator<FxNode, void, any> {
  context.onNodeEnter?.(node);
  try {
    switch (node.type) {
      case 'sequence':
        for (const step of node.steps) {
          yield* run(step, context);
        }
        break;

      case 'loop':
        while (node.cond()) {
          yield* run(node.body, context);
        }
        break;
      
      case 'condition':
        if (node.if()) {
          yield* run(node.then, context);
        } else if (node.else) {
          yield* run(node.else, context);
        }
        break;

      case 'switch':
        const key = node.by();
        const branch = node.cases.get(key) ?? node.default;
        if (branch) {
          yield* run(branch, context);
        }
        break;

      case 'none':
        break;

      default:
        // call, wait, take などのプリミティブな命令は、そのままexecuteに渡す
        yield node;
        break;
    }
    context.onNodeExit?.(node);
  } catch(err) {
    // エラーで完了した場合、 onNodeExit フックにエラー情報を渡す
    context.onNodeExit?.(node, undefined, err);
    throw err; // エラーは再スローする
  }
}


export async function execute(
  generator: Generator<FxNode, void, any>,
  context: IEffectContext,
  token: CancelToken = createCancelToken(),
  middlewares: FxMiddleware[] = [] // Middlewareの配列を受け取る
) {

  // コアのfxHandler呼び出し処理を、パイプラインの最後の一手として定義
  const coreMiddleware: FxMiddleware = async (ctx) => {
    return await ctx.handler({ node: ctx.node, context, token, execute, run });
  };

  const allMiddlewares = [...middlewares, coreMiddleware];

  let result = generator.next();
  let nextValue: any;

  while (!result.done) {
    if (token.cancelled()) break;
    const node = result.value;
    const handler = fxHandlers[node.type];
    if (!handler) throw new Error(`Unhandled FxNode type: ${node.type}`);

    // Middlewareに渡すコンテキストを準備
    const execCtx: FxExecutionContext = { node, context, token, run, execute, handler };

    // Middlewareパイプラインの実行を開始
    const runNextMiddleware = async (i: number): Promise<any> => {
      const middleware = allMiddlewares[i];
      if (!middleware) return; // パイプラインの終端
      // 次のMiddlewareを呼び出すための`next`関数を生成して渡す
      return await middleware(execCtx, () => runNextMiddleware(i + 1));
    };

    try {
      nextValue = await runNextMiddleware(0);
    } catch (err) {
      const catcher = (node as any).catcher;
      if(typeof catcher === 'function') {
          // ハンドラに処理を移譲
          console.warn(`[fx-effect] Action failed, but was handled by context.`, catcher);
          nextValue = catcher(err); // ハンドラの戻り値を、成功時の値としてフローに復帰させる
      } else {
        // ハンドラが見つからない場合は、エラーを再スローしてフローを停止
        console.error(`[fx-effect] Unhandled error: Catch handler not found in context.`);
        throw err;
      }
    }
    
    const state = {
      lastResult: nextValue
    };
    if(node.id) {
      state[node.id] = nextValue;
    }
    context.setRuntimeState(state);

    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  return { context, cancel: token.cancel };
}


