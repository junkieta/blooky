import { accum, drip, Prop, resolve, stream } from "../blooky-fp";
import { nodeDefinitionMap  } from "./nodes";
import { FxNode, FxCompiledNode, AppContext, CancelToken, ExecContext, FxExecutionContext, FxResult, YieldRequest, ExecutionHandle, PreparedFx, FxHandlerMap, FxFactoryMap } from "./types";

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


function createCancelToken(): CancelToken {
  let isCancelled = false;
  return {
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled,
  };
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
      // 1. yieldChannel$ に次に流れてくる値を待つ
      const nextResult : YieldRequest = await resolve(execContext.yieldChannel$);
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

  async function nestedExecute (n:FxNode) : Promise<AppContext> {
    const compiler = new FxNodeCompiler(appContext);
    return _internal_execute.call(this || ctx, run.call(this || ctx, compiler.compileNode(n)), appContext);
  }

  const allMiddlewares = middlewares ? [...middlewares] : [];

  let result = generator.next();
  let nextValue: any;

  while (!result.done) {
    if (cancelToken.cancelled()) break;
    const node = result.value;
    try {
      const definition = nodeDefinitionMap.get(node.type);
      if(!(definition)) throw new Error(`error: "${node.type}" is not unknown node type`);

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
          ? await definition.handle(fxec as any)
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
      drip({ id: node.id, value: nextValue })(this.runtimeState$)
        .effects.forEach(e => e.update(e.nextValue));
    }

    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  return appContext;
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

// FxNodeのrefを解決し、FxCompiledNodeに変換する
class FxNodeCompiler {
  factory = nodeDefinitionMap
  context: AppContext
  constructor(context: AppContext) {
    this.context = context;
  }
  
  compileNode(node: FxNode) : FxCompiledNode {
    return this.factory.has(node.type)
      ? this.factory.get(node.type)!.compile(node, this as any)
      : node as FxCompiledNode;
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

export {
  fx,
  FxRef, isFxRef, ref,
  FxNodeCompiler,
  run,prepare,execute,query,createCancelToken
}
