import { nodeDefinitionMap } from "./nodes";
import { accum, drip, Prop, stream } from "../blooky-fp";
import { FxNode, AppContext, CancelToken, ExecContext, FxExecutionContext, FxResult, YieldRequest, ExecutionHandle, PreparedFx, FxHandlerMap, FxFactoryMap } from "./types";

// 参照オブジェクトの型を定義（ブランド化して、他のオブジェクトと区別する）
const FxRefSymbol = Symbol("FxRef");
type FxRef<T> = { [FxRefSymbol]: true; key: string; } | Prop<T> | T;

/**
   * 実行時に解決されるkeyへの参照オブジェクトを生成する。
   */
const ref = <T>(key: string): FxRef<T> => ({ [FxRefSymbol]: true, key });
const isFxRef = <T>(v:unknown) : v is Extract<FxRef<T>,{ [FxRefSymbol]: true; key: string; }> => v && v[FxRefSymbol];

// --- ファクトリ (fxオブジェクト) の動的構築 ---
const fx = {} as FxFactoryMap;
nodeDefinitionMap.forEach((def, type) => {
  fx[type] = def.factory.bind(def);
});



function createCancelToken(parent?: CancelToken): CancelToken {
  let isCancelled = false;
  return {
    parent,
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled || (parent ? parent.cancelled() : false),
  }
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
  const $runtimeState = accum<Record<string,any>,FxResult>((res,acc) => ({ ...acc, ["#"+res.id]: res.value }), {})(runtimeState$)

  const execContext: ExecContext = {
    resolve: (v:FxRef<any>) => resolveValue(v)(proxyContext),
    ...parentExecContext,
    cancelToken,
    runtimeState$,
  };

  const proxyContext = new Proxy(initialAppContext, {
    get(target, key) {
      if (typeof key === 'string' && key.startsWith('#')) {
        return $runtimeState()[key];
      }
      return Reflect.get(target, key);
    },
    has(target, key) {
      if (typeof key === 'string' && key.startsWith('#')) {
        return key in $runtimeState();
      }
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...Reflect.ownKeys(target), ...Object.keys($runtimeState())];
    },
  });

  return {
    rootNode: flow,
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
  const { rootNode, execContext, appContext } = preparedFx;

  const runtimeContext : Omit<FxExecutionContext,"node"> = {
    run: (node:FxNode) => run.call(execContext, { ...runtimeContext, node }),
    execute(node: FxNode) {
      return _internal_execute.call(execContext.isPrototypeOf(this) ? this : execContext, runtimeContext.run(node), runtimeContext)
    },
    context: execContext,
    appContext
  };

  // 非同期で実行するランナーを開始（awaitしない）
  const resultPromise:Promise<AppContext> = runtimeContext.execute(rootNode);

  // 結果を消費するためのプル型インターフェース（非同期ジェネレータ）
  const resultsIterator = (async function* () {
    while (true) {
      // 次のリクエストが来るまで待つPromiseを生成
      const nextRequest = await new Promise<YieldRequest>(resolve => {
        // このresolve関数を、次のyieldが呼び出せるようにコンテキストに登録する
        execContext.yieldChannel = resolve;
      });
      // リクエストを受け取ったら、次のyieldに備えてハンドラを一旦クリア
      execContext.yieldChannel = undefined;
      // 受け取ったリクエストを for await...of ループに送り出す
      const responseFromConsumer = yield nextRequest;
      // 利用者からの応答があれば、待機中のyieldハンドラのPromiseを解決する
      if (nextRequest) {
        nextRequest.resolve(responseFromConsumer);
      }
    }
  })();

  // 実行ハンドルを同期的に返す
  const handle : ExecutionHandle = {
    cancel: execContext.cancelToken.cancel,
    results$: execContext.runtimeState$,
    fetch: () => resultsIterator,
    done: resultPromise,
    close: async (finalValue?: any) => {
      // ★ closeが呼ばれたら、GCによる自動クローズの対象から外す
      executionHandleRegistry.unregister(handle);
      // ★ もしyieldが待ち状態であれば、それを中断させる
      if (execContext.pendingYieldReject)
        execContext.pendingYieldReject(new Error('Flow was closed externally.'));
      // ★ フロー全体の実行をキャンセルし、完了させる
      handle.cancel();
    }
  };
  executionHandleRegistry.register(handle, new WeakRef(handle), handle);
  return handle;
}

// ガベージコレクト
const executionHandleRegistry = new FinalizationRegistry((handleToCloseRef: WeakRef<{ close: () => void }>) => {
  console.warn('[blooky-fx] An ExecutionHandle was garbage collected without being explicitly closed. Closing automatically.');
  const handle = handleToCloseRef.deref();
  if(handle) handle.close();
});

// prepare->exeuteのショートハンド
const query = (node: FxNode, app?: AppContext, ctx?: ExecContext) => 
  execute(prepare(node, app || {}, ctx));

// `execute`のコアロジックは、プライベートなヘルパー関数に移動
async function _internal_execute(
  this: ExecContext,
  generator: Generator<FxNode, any, any>,
  ctx: FxExecutionContext
): Promise<AppContext> {
  // `this`から実行設定を取得
  const { cancelToken, middlewares } = this;
  const allMiddlewares = middlewares ? [...middlewares] : [];
  let result = generator.next();
  let nextValue: any;
  let node: FxNode;
  while (!result.done) {
    node = result.value;
    if(cancelToken.cancelled()) {
      generator.throw("canceled");
      break;
    }
    try {
      const definition = nodeDefinitionMap.get(node.type);
      if(!(definition))
        throw new Error(`error: "${node.type}" is not unknown node type`);

      // ★各ステップの情報をまとめたFxExecutionContextを生成
      const fxec: FxExecutionContext = { ...ctx, node };

      // ミドルウェアパイプラインの実行
      const runNextMiddleware = async (i: number): Promise<any> => {
        const middleware = allMiddlewares[i];
        return i === allMiddlewares.length
          ? await definition.handle(fxec as any)
          : middleware
          ? await middleware(fxec, () => runNextMiddleware(i + 1))
          : undefined;
      };
      nextValue = await runNextMiddleware(0);

    } catch(err) {
      let catcher = (node as any).catcher;
      if(typeof catcher !== "function" && catcher) catcher = this.resolve(catcher);
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
      drip({ id: node.id, value: nextValue })(this.runtimeState$).effects.forEach(e => e.update(e.nextValue, e.prevValue));
    }

    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  return this.cancelToken;
}

// ランナー。nodeを辿るジェネレータを返す
function* run(
  this: ExecContext,
  ctx: FxExecutionContext
): Generator<FxNode, any, any> {
  const node = ctx.node;
  this.onNodeEnter?.(node);
  try {
    // 各ノードのDefinitionにナビゲーションを委譲する
    const definition = nodeDefinitionMap.get(node.type)!;
    yield* definition.step(ctx);
    this.onNodeExit?.(node);
  } catch(err) {
    // エラーで完了した場合、onNodeExit フックにエラー情報を渡す
    if(err instanceof Error) {
      this.onNodeExit?.(node, undefined, err);
      throw err; // エラーは再スローする
    } else if(err === "canceled"){
      this.onNodeExit?.(node, err);
      throw err;
    }
  }
}



/**
 * 現在の処理を一旦中断し、後続の処理を新しいマイクロタスクとして予約するPromiseを返す。
 * これにより、メインスレッドに一度処理を「譲る」ことができる。
 */
function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    queueMicrotask(resolve);
  });
}

export {
  fx, FxRef, isFxRef, ref,
  run,prepare,execute,query,createCancelToken
}

// FxRef, Prop, または静的な値を、常に()=>Prop（ゲッター関数）に正規化するヘルパー
const resolveValue = <T>(value: FxRef<T>) => (context: AppContext) : Prop<T> => {
  if (isFxRef<T>(value)) { 
    if(!(value.key in context)) {
      throw new Error(`"${value.key}" cannot resolve from context.`)
    }
    value = context[value.key];
  }
  return typeof value === "function" ? value as Prop<T> : () => value as T;
}

