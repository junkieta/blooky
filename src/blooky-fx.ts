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
      action: (v:any) => unknown,
      arg?: any,
      context?: any,
      catcher?: (error: Error) => unknown
    }>
  | FxNodeBase<"drip", {
      stream: DripperStream<any>,
      value: Prop<any>,
      catcher?: (error: Error) => unknown,
      mode?: "saga" | "atomic"
      promise?: "deny"|"allow"|"await"
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
  call: (action: (v:any) => unknown, options?: { arg?: any, context?: any, catcher?: (v:Error) => unknown, id?: string }): FxNode => ({
    ...options,
    type: "call",
    action,
  }),
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
  drip: <T>(value: Prop<T>, stream: DripperStream<T>, options?: { promise?: "deny"|"allow"|"await", catcher?: (v:Error) => unknown, mode?: "saga"|"atomic" }): FxNode => ({
    ...options,
    type: "drip",
    stream,
    value,
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
export interface AppContext {

  /**
   * 実行時の状態を書き込むためのメソッド。
   * @param state 実行状態を表すオブジェクト
   */
  setRuntimeState(state: { [key:string]: any, lastResult: any }): void;

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
  node: Extract<FxNode, { type: K }>;
  execute: (n: FxNode) => Promise<ExecContext>;
  context: ExecContext;
  appContext: AppContext;
};

export type FxHandlerMap = {
  [K in FxNode["type"]]?: (
    ctx: FxExecutionContext & { node: Extract<FxNode, { type: K }> }
  ) => Promise<any>
};

export const fxHandlers: FxHandlerMap = {
  call: async ({ node }) => {
    await node.action.call(node.context, node.arg);
  },
  wait: async ({ node }) => await new Promise(res => setTimeout(res, node.ms)),
  drip: async ({ node,execute,context }) => {
    const catcher = node.catcher;
    const effect = await drip(node.value(), { acceptPromise: node.promise ?? "deny" })(node.stream);
    const _fx = node.mode === "atomic"
      ? fx.call(()=>effect.forEach(({update,nextValue})=>update(nextValue)), { catcher })
      : fx.parallel(effect.map(({update,nextValue})=>fx.call(update, { arg: nextValue, catcher })));
    await execute.call(context, _fx);
  },
  dispatch: async ({node,execute,context}) => {
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
        await execute.call(context, node.child);
  },
  take: async ({ node }) => await resolve(node.stream),
  parallel: async ({ node, execute }) => {
    // node.stepsに含まれる各フローに対して、executeを並列で実行する
    await Promise.all(node.steps.map(execute));
  },
  race: async ({ node, context, execute }) => {
    // 各レーサー（ステップ）に、個別にキャンセル可能なトークンを用意する
    const racers = node.steps.map(step => {
      const racerToken = createCancelToken();
      // メインのtokenか、個別tokenのどちらかがキャンセルされたらキャンセルとみなす
      const combinedToken: CancelToken = {
        cancelled: () => context.cancelToken.cancelled() || racerToken.cancelled(),
        cancel: () => { context.cancelToken.cancel(); racerToken.cancel(); },
      };
      return {
        promise: execute.call(new Proxy(context, {
          get: (t,p) => p==="cancelToken" ? combinedToken : Reflect.get(t,p)
        }), step),
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

// 実行全体の設定
export interface ExecContext {
  cancelToken: CancelToken;
  middlewares?: FxMiddleware[];
  onNodeEnter?: (node: FxNode) => void;
  onNodeExit?: (node: FxNode, result?: any, error?: Error) => void;
}

// ミドルウェアに渡される、各ステップの情報
interface FxExecutionContext {
  node: FxNode;
  execute: (n:FxNode)=>Promise<ExecContext>
  context: ExecContext
  appContext: AppContext
}

// Middlewareの関数型
export type FxMiddleware = (
  ctx: FxExecutionContext,
  next: () => Promise<any> // 次のMiddlewareを呼び出すための関数
) => Promise<any>;

export function* run(
  this: ExecContext,
  node: FxNode
): Generator<FxNode, void, any> {
  this.onNodeEnter?.(node);
  try {
    switch (node.type) {
      case 'sequence':
        for (const step of node.steps) {
          yield* run.call(this, step);
        }
        break;

      case 'loop':
        while (node.cond()) {
          yield* run.call(this, node.body);
        }
        break;
      
      case 'condition':
        if (node.if()) {
          yield* run.call(this, node.then);
        } else if (node.else) {
          yield* run.call(this, node.else);
        }
        break;

      case 'switch':
        const key = node.by();
        const branch = node.cases.get(key) ?? node.default;
        if (branch) {
          yield* run.call(this, branch);
        }
        break;

      case 'none':
        break;

      default:
        // call, wait, take などのプリミティブな命令は、そのままexecuteに渡す
        yield node;
        break;
    }
    this.onNodeExit?.(node);
  } catch(err) {
    // エラーで完了した場合、 onNodeExit フックにエラー情報を渡す
    this.onNodeExit?.(node, undefined, err);
    throw err; // エラーは再スローする
  }
}
export async function execute(
  this: ExecContext,
  generator: Generator<FxNode, void, any>,
  appContext: AppContext
) {
  // `this`から実行設定を取得
  const { cancelToken, middlewares } = this;

  // executeのthisをハンドラで置き換えることがあるので、アロー関数は使わない
  const nestedExecute = function(n:FxNode) : Promise<ExecContext> {
    return execute.call(this, run.call(this, n), appContext);
  }

  const allMiddlewares = middlewares ? [...middlewares] : [];

  let result = generator.next();
  let nextValue: any;

  while (!result.done) {
    if (cancelToken.cancelled()) break;
    const node = result.value;
    try {
      if(!(node.type in fxHandlers)) throw new Error(`error: "${node.type}" is not unknown node type`);

      const handler = fxHandlers[node.type]!;

      // ★各ステップの情報をまとめたFxExecutionContextを生成
      const fxec: FxExecutionContext = {
        node,
        execute: nestedExecute,
        context: this,
        appContext
      };

      // ミドルウェアパイプラインの実行
      const runNextMiddleware = async (i: number): Promise<any> => {
        const middleware = allMiddlewares[i];
        return !middleware
          ? await handler(fxec as any)
          : await middleware(fxec, () => runNextMiddleware(i + 1));
      };
      nextValue = await runNextMiddleware(0);

    } catch(err) {
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
    appContext.setRuntimeState(state);
    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  return this;
}


