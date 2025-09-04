import { nodeDefinitionMap } from "./fx/nodes";
import { Prop } from "./blooky-fp";
import { FxNode, AppContext, CancelToken, ExecContext, FxExecutionContext, ExecutionHandle, PreparedFx, FxFactoryMap } from "./fx/types";

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
  // 未定義のキー参照を調べる
  const [required,idList] = checkContext(initialAppContext)(flow);
  if (required.length && required.some((k) => !idList.includes(k)))
      throw new Error(`prepare: context missing keys: ${[...new Set(required)].join(",")}`);

  const idRecord: { [key:string]: unknown } = {};
  const NOT_RESOLVED = Symbol();
  [...new Set(idList)].forEach((id)=> idRecord[id] = NOT_RESOLVED);
  // ノードツリー内で宣言済みのidだけを受け付ける
  Object.seal(idRecord);

  const appContext = createProxyContext(initialAppContext, idRecord);
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
      return _internal_execute.call(context || execContext, runtimeContext.run(node), runtimeContext)
    },
    context: execContext,
    appContext
  };

  const resultPromise:Promise<AppContext> = runtimeContext.execute(rootNode);

  // 実行ハンドルを同期的に返す
  const handle : ExecutionHandle = {
    cancel: execContext.cancelToken.cancel,
    done: resultPromise,
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

    // nodeにidがあれば、appContextに反映(厳密には、Proxyしているidレコードにセット)
    if (node.id && ("#" + node.id) in ctx.appContext) {
      ctx.appContext["#" + node.id] = nextValue;
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
const createProxyContext = (appContext: AppContext, idRecord: { [key:string]: unknown }): AppContext => {
  return new Proxy(appContext, {
    get(target, key) {
      if (typeof key === 'string' && key in idRecord) {
        return idRecord[key];
      }
      return Reflect.get(target, key);
    },
    // id参照の更新のみ受け付ける
    set(_,key,value) {
      if (typeof key === 'string' && idRecord.hasOwnProperty(key)) {
        idRecord[key] = value;
        return true;
      }
      return false;
    },
    has(target, key) {
      if (typeof key === 'string' && key.startsWith('#')) {
        return key in idRecord;
      }
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...Reflect.ownKeys(target), ...Object.keys(idRecord)];
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

// --- 矛盾チェック用キーリストの準備 ---
const checkContext = (context: AppContext) => (node: FxNode) : [string[],string[]] => {
  // FxRef型の値をチェック
  const keys: string[] = Object.values(node).filter((v) => isFxRef<unknown>(v) && !(v.key in context)).map((v)=>v.key);
  // idの有無をチェック
  const id = node.id ? ["#"+node.id] : [];
  const children = nodeDefinitionMap.get(node.type)!.getChildNodes(node);
  if(!children) return [keys,id];
  const child_result = children.map(checkContext(context));
  return [
    keys.concat(child_result.flatMap(([v])=>v)),
    id.concat(child_result.flatMap(([_,v])=>v))
  ]
};


export {
  fx, FxRef, isFxRef, ref,
  run,prepare,execute,query,createCancelToken,createProxyContext
}

