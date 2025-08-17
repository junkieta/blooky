// blooky-effect.ts
import { DripperStream, isChainedProp, Prop, proxy, Stream } from "./blooky";
import { accum, drip, hold, resolve, stream } from "./blooky";

//
// 型定義
//
type FxNodeBase<T extends string, P = {}> = P & {
  type: T
  id?: string
};

type FxNode =
  | FxNodeBase<"none">
  | FxNodeBase<"sequence", { steps: FxNode[] }>
  | FxNodeBase<"parallel", { steps: FxNode[] }>
  | FxNodeBase<"race", { steps: FxNode[] }>
  | FxNodeBase<"wait", { ms: FxRef<number> }>
  | FxNodeBase<"loop", {
      cond: FxRef<boolean>,
      body: FxNode
    }>
  | FxNodeBase<"condition", {
      if: FxRef<boolean>,
      then: FxNode,
      else?: FxNode
    }>
  | FxNodeBase<"switch", {
      by: FxRef<string | number | symbol>,
      cases: Map<string | number | symbol, FxNode>,
      default?: FxNode
    }>
  | FxNodeBase<"call", {
      action: FxRef<(v:any) => unknown>,
      arg?: FxRef<any>,
      context?: FxRef<any>,
      catcher?: FxRef<(error: Error) => unknown>
    }>
  | FxNodeBase<"drip", {
      stream: FxRef<DripperStream<any>>,
      value: FxRef<any>,
      catcher?: FxRef<(error: Error) => unknown>,
      mode?: FxRef<"saga" | "atomic">
      promise?: FxRef<"deny"|"allow"|"await">
    }>
  | FxNodeBase<"dispatch", {
      name: FxRef<string>,
      settings: FxDispatchSettings<FxRef<any>>,
      child?: FxNode
    }>
  | FxNodeBase<"take", {
      stream: FxRef<Stream<any>>
    }>
  | Required<FxNodeBase<"yield"> & {
      value: FxRef<any>
    }>

type FxDispatchSettings<A> = CustomEventInit<A> & {
  target: string|EventTarget;
};

type FxCompiledNodeBase<T extends string, P = {}> = FxNodeBase<T,P>;
type FxCompiledNode =
  | FxCompiledNodeBase<"none">
  | FxCompiledNodeBase<"sequence", { steps: FxCompiledNode[] }>
  | FxCompiledNodeBase<"parallel", { steps: FxCompiledNode[] }>
  | FxCompiledNodeBase<"race", { steps: FxCompiledNode[] }>
  | FxCompiledNodeBase<"wait", { ms: Prop<number> }>
  | FxCompiledNodeBase<"loop", {
      cond: Prop<boolean>,
      body: FxCompiledNode
    }>
  | FxCompiledNodeBase<"condition", {
      if: Prop<boolean>,
      then: FxCompiledNode,
      else?: FxCompiledNode
    }>
  | FxCompiledNodeBase<"switch", {
      by: Prop<string | number | symbol>,
      cases: Map<string | number | symbol, FxNode>,
      default?: FxCompiledNode
    }>
  | FxCompiledNodeBase<"call", {
      action: (v:any) => unknown,
      arg?: Prop<any>,
      context?: Prop<any>,
      catcher?: (error: Error) => unknown
      }>
  | FxCompiledNodeBase<"drip", {
      stream: Prop<DripperStream<any>>,
      value: Prop<any>,
      catcher?: (error: Error) => unknown,
      mode?: Prop<"saga" | "atomic">
      promise?: Prop<"deny"|"allow"|"await">
    }>
  | FxCompiledNodeBase<"dispatch", {
      name: Prop<string>,
      settings: FxDispatchSettings<Prop<any>>,
      child?: FxCompiledNode
    }>
  | FxCompiledNodeBase<"take", {
      stream: Prop<Stream<any>>
    }>
  | Required<FxCompiledNodeBase<"yield"> & {
      value: Prop<any>
    }>

    
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

// 参照オブジェクトの型を定義（ブランド化して、他のオブジェクトと区別する）
const FxRefSymbol = Symbol("FxRef");
type FxRef<T> = { [FxRefSymbol]: true; key: string; } | Prop<T> | T;

/**
   * 実行時に解決されるkeyへの参照オブジェクトを生成する。
   */
const ref = <T>(key: string): FxRef<T> => ({ [FxRefSymbol]: true, key });
const isFxRef = <T>(v:unknown) : v is Extract<FxRef<T>,{ [FxRefSymbol]: true; key: string; }> => v && v[FxRefSymbol];

/**
 * エフェクト実行エンジンが要求するコンテキストの機能。
 */
type AppContext = Record<string, any>;

type CancelToken = { cancel: () => void; cancelled: () => boolean };
function createCancelToken(): CancelToken {
  let isCancelled = false;
  return {
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled,
  };
}


type FxHandlerMap = {
  [K in FxCompiledNode["type"]]?: (
    ctx: FxExecutionContext & { node: Extract<FxCompiledNode, { type: K }> }
  ) => Promise<any>
};

const fxHandlers: FxHandlerMap = {
  call: async ({ node }) => await node.action.call(node.context?.(), node.arg?.()),
  wait: async ({ node }) => await new Promise(res => setTimeout(res, node.ms())),
  drip: async ({ node,appContext }) => {
    const catcher = node.catcher;
    const effect = await drip(node.value(), { acceptPromise: node.promise?.() ?? "deny" })(node.stream());
    const _fx = node.mode?.() === "atomic"
      ? fx.call(()=>effect.forEach(({update,nextValue})=>update(nextValue)), { catcher })
      : fx.parallel(effect.map(({update,nextValue})=>fx.call(update, { arg: nextValue, catcher }))
      );
    await query(_fx, appContext);
  },
  dispatch: async ({node,execute,context}) => {
    const settings = node.settings;
    const e = new CustomEvent(node.name(), {
      ...settings,
      detail: settings.detail?.() ?? undefined 
    });

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
  take: async ({ node }) => await resolve(node.stream()),
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
  yield: ({ node,context }) => {
    // 1. 応答が返されるまで待機する、新しいPromiseを生成
    return new Promise(resolve => {
      // 2. このPromiseのresolve関数を、結果と共にdripする
      drip<YieldRequest>({
        id: node.id,
        value: node.value(),
        resolve: resolve // ★応答用のコールバックを同梱
      })(context.yieldChannel$) 
        .forEach((e)=>e.update(e.nextValue));
    });
  }
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

// 実行全体の設定
interface ExecContext {
  cancelToken: CancelToken;
  middlewares?: FxMiddleware[];
  onNodeEnter?: (node: FxCompiledNode) => void;
  onNodeExit?: (node: FxCompiledNode, result?:any, error?: Error) => void;
  runtimeState$: DripperStream<FxResult>; // 結果報告用
  yieldChannel$: DripperStream<YieldRequest>; // 対話用
}

// ミドルウェアに渡される、各ステップの情報
interface FxExecutionContext {
  node: FxCompiledNode;
  execute: (n:FxNode)=>Promise<ExecContext>
  context: ExecContext
  appContext: AppContext
}

// Middlewareの関数型
type FxMiddleware = (
  ctx: FxExecutionContext,
  next: () => Promise<any> // 次のMiddlewareを呼び出すための関数
) => Promise<any>;

// ランナー。nodeを辿るジェネレータを返す
function* run(
  this: ExecContext,
  node: FxCompiledNode
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

/**
 * 実行準備が完了した副作用フローを表すオブジェクト。
 * prepare関数によって生成され、execute関数に渡される。
 */
interface PreparedFx {
  readonly generator: Generator<FxNode, void, any>;
  readonly execContext: ExecContext;
  readonly appContext: AppContext; // プロキシされたコンテキスト
}

/**
 * 副作用フローの実行結果を表す、idと値のペア。
 */
type FxResult = {
  id: string; // 結果を生成したFxNodeのid
  value: any; // 結果の値
};

type YieldRequest = {
  id: string; // 結果を生成したFxNodeのid
  value: any; // 結果の値
  resolve: (response: any) => void;
}

/**
 * 実行中の副作用フローを制御し、結果を消費するためのハンドル。
 */
interface ExecutionHandle {
  /**
   * フローの実行をキャンセルする。
   */
  cancel: () => void;

  /**
   * フローが生成するid付きの結果をプッシュ型で受け取るためのStream。
   * UIのリアルタイム更新など、宣言的なリアクティブ連携に最適。
   */
  results$: Stream<FxResult>;

  /**
   * フローの結果をプル型で、逐次的に取得するための非同期ジェネレータ。
   * `fx.yield`を使った対話的なフローに利用できる。
   */
  results(): AsyncGenerator<YieldRequest, void, any>;

  /**
   * 実行の完了を知らせるPromise
   */
  done: Promise<AppContext>
}

/**
 * 副作用フローを実行可能な状態に準備し、PreparedFxオブジェクトを返す。
 * この関数は副作用をまだ実行しない。
 *
 * @param flow 実行するFxNodeツリー
 * @param initialAppContext アプリケーションの初期依存関係
 * @param parentExecContext 親の実行コンテキスト（オプション）
 * @returns PreparedFx
 */
function prepare(
  flow: FxNode,
  initialAppContext: AppContext,
  parentExecContext?: Partial<ExecContext>
): PreparedFx {
  
  const cancelToken = createCancelToken();
  const runtimeState$ = stream<FxResult>();
  const $runtimeState = accum<Record<string,any>,FxResult>((res,acc) => ({ ...acc, [res.id]: res.value }), {})(runtimeState$)
  const yieldChannel$ = stream<YieldRequest>();

  const execContext: ExecContext = {
    ...parentExecContext,
    cancelToken,
    yieldChannel$,
    runtimeState$,
  };

  const proxyContext = new Proxy(initialAppContext, {
    get(target, key) {
      if (typeof key === 'string' && key.startsWith('#')) {
        const id = key.slice(1);
        return $runtimeState()[id];
      }
      return Reflect.get(target, key);
    },
    has(target, key) {
      if (typeof key === 'string' && key.startsWith('#')) {
        const id = key.slice(1);
        return id in $runtimeState();
      }
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...Reflect.ownKeys(target), ...Object.keys($runtimeState())];
    },
  });

  const compiler = new FxNodeCompiler(proxyContext);
  // 最初に渡されたflowをコンパイルする
  const compiledFlow = compiler.compileNode(flow);

  const generator = run.call(execContext, compiledFlow);
  return {
    generator,
    execContext,
    appContext: proxyContext,
  };
}

/**
 * 準備された副作用フローの実行を開始し、ExecutionHandleを同期的に返す。
 *
 * @param preparedFx prepare関数が返したオブジェクト
 * @returns ExecutionHandle
 */
function execute(preparedFx: PreparedFx): ExecutionHandle {
  const { generator, execContext, appContext } = preparedFx;

  // 非同期で実行するランナーを開始（awaitしない）
  const resultPromise:Promise<AppContext> = _internal_execute.call(
    execContext,
    generator,
    appContext
  );

  // 結果を消費するためのプル型インターフェース（非同期ジェネレータ）
  const resultsIterator = (async function* () {
    while (true) {
      // 1. runtimeState$ に次に流れてくる値を待つ
      const nextResult = await resolve(execContext.yieldChannel$);
      // 2. for await...of ループに値をyieldして送り出す
      //    同時に、next()で渡される応答を待つ
      const responseFromConsumer = yield nextResult;
      // 3. 応答があれば、待機中のexecuteエンジンに応答を送り返す
      if (nextResult) {
        nextResult.resolve(responseFromConsumer);
      }
    }
  })();

  // 実行ハンドルを同期的に返す
  return {
    cancel: execContext.cancelToken.cancel,
    results$: execContext.runtimeState$,
    results: () => resultsIterator,
    done: resultPromise
  };
}

// prepare->exeuteのショートハンド
const query = (node: FxNode, app?: AppContext, ctx?: ExecContext) => 
  execute(prepare(node, app || {}, ctx));

// `execute`のコアロジックは、プライベートなヘルパー関数に移動
async function _internal_execute(
  this: ExecContext,
  generator: Generator<FxCompiledNode, void, any>,
  appContext: AppContext
): Promise<AppContext> {
  // `this`から実行設定を取得
  const ctx = this;
  const { cancelToken, middlewares } = this;

  async function nestedExecute (n:FxNode) : Promise<ExecContext> {
    const compiler = new FxNodeCompiler(appContext);
    console.log(this || ctx, run.call(this || ctx, compiler.compileNode(n)), appContext);
    return _internal_execute.call(this || ctx, run.call(this || ctx, compiler.compileNode(n)), appContext);
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
        return i === allMiddlewares.length
          ? await handler(fxec as any)
          : middleware
          ? await middleware(fxec, () => runNextMiddleware(i + 1))
          : undefined;
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
    
    // nodeにidがあれば、その結果をruntimeState$にdripする
    if (node.id) {
      // このdripは、エンジン内部の通信のため、同期的に実行する必要がある
      const effect = drip({ id: node.id, value: nextValue })(this.runtimeState$);
      effect.forEach(e => e.update(e.nextValue));
    }

    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  return appContext;
}

export type {
  FxExecutionContext,
  ExecutionHandle,
  ExecContext,
  FxNode,
  FxCompiledNode,
  FxMiddleware,
  PreparedFx,
  YieldRequest,
  FxHandlerMap,
  CancelToken,
  FxRef,
  FxResult,
  FxDispatchSettings,
  AppContext,
}

export {
  fx,ref,isFxRef,run,prepare,execute,createCancelToken
}

// -- FxNodeの型に応じたコンパイル処理 --
const FxNodeVisitor : {[K in FxNode["type"]]?: (
  node: Extract<FxNode, { type: K }>,
  compiler: FxNodeCompiler
) => Extract<FxCompiledNode, { type: K }> } = {

  sequence(node, compiler) {
    return Object.create(node, {
      steps: { value: node.steps.map((n)=>compiler.compileNode(n)) }
    });
  },

  loop(node, compiler) {
    return Object.create(node, {
      cond: { value: compiler.resolveValue(node.cond) },
      body: { value: compiler.compileNode(node.body) }
    });
  },

  condition(node,compiler) {
    return Object.create(node, {
      if: { value: compiler.resolveValue(node.if) },
      then: { value: compiler.compileNode(node.then) },
      else: { value: node.else ? compiler.compileNode(node.else) : undefined }
    });
  },

  switch(node, compiler) {
    return Object.create(node, {
        by: {value: compiler.resolveValue(node.by) },
        // Mapの各value（FxNode）を再帰的にコンパイルする
        cases: {value: new Map(Array.from(node.cases.entries()).map(([key, caseNode]) => [key, compiler.compileNode(caseNode)])) },
        default: {value: node.default ? compiler.compileNode(node.default) : undefined },
    });
  },

  wait(node, compiler) {
    return Object.create(node, {
        ms: { value: compiler.resolveValue(node.ms) }
    });
  },

  call(node,compiler) {
    return Object.create(node, {
      action: { value: compiler.resolveAction(node.action) },
      arg: { value: compiler.resolveValue(node.arg) },
      context: { value: compiler.resolveValue(node.context) },
      catcher: { value: node.catcher 
        ? compiler.resolveAction(node.catcher) 
        : undefined },
    });
  },
  drip(node, compiler){
    return Object.create(node, {
        stream: { value: compiler.resolveValue(node.stream) },
        value: { value: compiler.resolveValue(node.value) },
        mode: { value: node.mode ? compiler.resolveValue(node.mode) : undefined },
        promise: { value: node.promise ?  compiler.resolveValue(node.promise) : undefined },
        catcher: { value: node.catcher
          ? compiler.resolveAction(node.catcher) 
          : undefined },
    });
  },

  take(node,compiler){
    return Object.create(node, {
        stream: { value: compiler.resolveValue(node.stream) }
    });
  },

  yield(node, compiler) {
    return Object.create(node, {
        value: { value: compiler.resolveValue(node.value) }
    });
  },

  dispatch(node,compiler) {
    return Object.create(node, {
        name: { value: compiler.resolveValue(node.name) },
        settings: {
          value: {
            detail: node.settings?.detail ? compiler.resolveValue(node.settings.detail) : undefined
          }
        },
        child: {value: node.child ? compiler.compileNode(node.child) : undefined }
    });
  },

  // プリミティブなノードや、解決不要なノードはそのまま返す
  none(node) {
    return node;
  }

};
// ロジックが同じものは型定義だけ上書きして代入
FxNodeVisitor.parallel = FxNodeVisitor.sequence as unknown as
  (node: Extract<FxNode, { type: "parallel" }>, compiler: FxNodeCompiler) => Extract<FxCompiledNode, { type: "parallel" }>;
FxNodeVisitor.race = FxNodeVisitor.sequence as unknown as
  (node: Extract<FxNode, { type: "race" }>, compiler: FxNodeCompiler) => Extract<FxCompiledNode, { type: "race" }>;

// FxNodeのrefを解決し、FxCompiledNodeに変換する
class FxNodeCompiler {
  visitor = FxNodeVisitor
  context: AppContext
  constructor(context: AppContext) {
    this.context = context;
  }
  compileNode(node: FxNode) : FxCompiledNode {
    return node.type in this.visitor ? this.visitor[node.type]!(node as any, this) : node as FxCompiledNode;
  }
  // FxRef, Prop, または静的な値を、常にProp（ゲッター関数）に正規化するヘルパー
  resolveValue<T>(value: FxRef<T>): Prop<T> {
    if (typeof value === 'function') return value as Prop<T>; // Propはそのまま
    if (isFxRef(value)) {
      // FxRefは、proxyContextから値を解決するPropに変換
      return () => {
        if(!(value.key in this.context)) {
          throw new Error(`"${value.key}" cannot resolve from context.`)
        }
        return this.context[value.key]
      }
    }
    // 静的な値は、その値を返すだけのPropに変換
    return () => value;
  }

  // FxRef, または作用を含む関数を、関数に解決する
  resolveAction(value: unknown): (v:any)=>unknown {
    if(typeof value === 'function')
      return value as (v:any)=>unknown;
    if(isFxRef(value)) 
      return this.resolveValue<(v:any)=>unknown>(value)();
    return () => value;
  }

}
