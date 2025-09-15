import { nodeDefinitionMap } from "./fx/nodes";
import { Prop } from "./blooky-fp";
import { FxNode, AppContext, CancelToken, ExecContext, FxExecutionContext, ExecutionHandle, PreparedFx, FxFactoryMap } from "./fx/types";
import { RETURN_VALUE } from "./fx/nodes/return";

// 参照オブジェクトの型を定義（ブランド化して、他のオブジェクトと区別する）
const FxRefSymbol = Symbol("FxRef");
type FxRef<T> = { [K in typeof FxRefSymbol]: true; } & { key: string; } | Prop<T> | T;

/**
 * 実行時に解決されるkeyへの参照オブジェクトを生成する。
 */
const ref = <T>(key: string): FxRef<T> => ({ [FxRefSymbol]: true, key });
const isFxRef = <T>(v:unknown) : v is Extract<FxRef<T>,{ [K in typeof FxRefSymbol]: true; } & { key: string; }> => v && (v as any)[FxRefSymbol];

// --- ファクトリ (fxオブジェクト) の動的構築 ---
const fx = {} as FxFactoryMap;
nodeDefinitionMap.forEach((def, type) => {
  (fx as any)[type] = def.factory.bind(def);
});

function createCancelToken(parent?: CancelToken): CancelToken {
  let isCancelled = false;
  return {
    parent,
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled || (parent ? parent.cancelled() : false),
  }
}

const NotResolved = Symbol.for("NotResolved");

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

  // id所持ノードの結果を格納するRecord
  const localRecord: { [key:string|symbol]: unknown } = {
    yieldedValue: NotResolved,
    [RETURN_VALUE]: RETURN_VALUE in initialAppContext ? initialAppContext[RETURN_VALUE] : NotResolved
  };
  const nodes = flattenFxNode(flow);
  nodes.filter((n)=>n.id).forEach((n) => localRecord["#"+n.id!] = n.type === "context" ? n : NotResolved);
  // 受け取り済みのコンテキストにidRecordの参照を紐づける
  const appContext = createProxyContext(initialAppContext, localRecord);

  // 未定義のキー参照を調べる
  const missingKeys : string[] = nodes.flatMap((n)=>Object.values(n).filter((v) => isFxRef<unknown>(v) && !(v.key in appContext)).map((v)=>v.key));
  if (missingKeys.length) {
    throw new Error(`prepare: context missing keys: ${missingKeys.join(",")}`);
  }

  // ノードツリー内で宣言済みのidだけを受け付ける
  Object.seal(localRecord);

  const cancelToken = createCancelToken();
  const execContext: ExecContext = {
    resolve: (v:FxRef<any>) => resolveValue(v)(appContext),
    ...parentExecContext,
    cancelToken
  };
  return {
    rootNode: flow,
    execContext,
    appContext,
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
    run(node:FxNode, context?: ExecContext) {
      return run.call(context || execContext, { ...runtimeContext, node })
    },
    execute(node: FxNode, context?: ExecContext) {
      return _internal_execute.call(context || execContext, runtimeContext.run(node), runtimeContext as FxExecutionContext)
    },
    context: execContext,
    appContext
  };

  const done:Promise<AppContext> = runtimeContext.execute(rootNode);

  // 実行ハンドルを同期的に返す
  const handle : ExecutionHandle = {
    cancel: execContext.cancelToken.cancel,
    done
  };
  
  return handle;
}

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

      // 各ステップの情報をまとめたFxExecutionContextを生成
      const fxec: FxExecutionContext = { ...ctx, node };

      // ミドルウェアパイプラインの実行
      const runNextMiddleware = async (i: number): Promise<any> => {
        const middleware = allMiddlewares[i];
        return i === allMiddlewares.length
          ? await definition.handle(fxec)
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

    // nodeにidがあれば、appContextに反映(厳密には、Proxyしているidレコードにセット)
    if (node.id && ("#" + node.id) in ctx.appContext) {
      ctx.appContext["#" + node.id] = nextValue;
    }

    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  return ctx.appContext;
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
    }
    else if(err === "canceled"){
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

// Proxyコンテキストを生成するヘルパー関数
const createProxyContext = (appContext: AppContext, idRecord: { [key:string|symbol]: unknown }): AppContext => {
  return new Proxy(appContext, {
    get(target, key) {
      if (key in idRecord) {
        return idRecord[key];
      }
      return Reflect.get(target, key);
    },
    // id参照の更新のみ受け付ける
    set(_,key,value) {
      if (key in idRecord) {
        idRecord[key] = value;
        return true;
      }
      return false;
    },
    has(target, key) {
      return key in idRecord || Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...Reflect.ownKeys(target), ...Object.keys(idRecord)];
    },
    getOwnPropertyDescriptor(target, key) {
      if(key in idRecord)
        return {
          value: idRecord[key],
          enumerable: true,
          writable: true,
          configurable: true
        }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },    
  });
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


const flattenFxNode = (n:FxNode): FxNode[] => {
  const children = nodeDefinitionMap.get(n.type)!.getChildNodes(n);
  return children
    ? [n, ...children.flatMap(flattenFxNode)]
    : [n];
}


export {
  fx, FxRef, isFxRef, ref,
  run,prepare,execute,query,createCancelToken,createProxyContext
}

