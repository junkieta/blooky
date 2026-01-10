import { nodeDefinitionMap } from "./fx/nodes";
import { blooky } from "./blooky-fp";
import { FxNode, AppContext, CancelToken, ExecContext, FxExecutionContext, ExecutionHandle, PreparedFx, FxFactoryMap } from "./fx/types";
import { RETURN_VALUE } from "./fx/nodes/return";
import { Prop } from "./blooky-types";

// 参照オブジェクトの型を定義（ブランド化して、他のオブジェクトと区別する）
const FxRefSymbol = Symbol("FxRef");
type FxRef<T> = { [K in typeof FxRefSymbol]: true; } & { key: string; } | Prop<T> | T;

/**
 * 実行時に解決されるキーへの参照オブジェクトを生成する。
 * @param key 参照するコンテキストキー
 * @returns FxRefオブジェクト
 */
const ref = <T>(key: string): FxRef<T> => ({ [FxRefSymbol]: true, key });

/**
 * 値がFxRefオブジェクトであるかどうかを判定する。
 * @param v 判定する値
 * @returns FxRefであればtrue
 */
const isFxRef = <T>(v:unknown) : v is Extract<FxRef<T>,{ [K in typeof FxRefSymbol]: true; } & { key: string; }> => v && (v as any)[FxRefSymbol] === true;

// --- ファクトリ (fxオブジェクト) の動的構築 ---
const fx = {} as FxFactoryMap;
nodeDefinitionMap.forEach((def, type) => {
  (fx as any)[type] = def.factory.bind(def);
});

/**
 * キャンセルトークンを生成する。
 * @param parent 親のキャンセルトークン（オプション）
 * @returns CancelToken
 */
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

  // id所持ノードの結果、および特殊な戻り値を格納するレコード
  const localRecord: { [key:string|symbol]: unknown } = {
    // $で始まる特殊なコンテキストキーの初期化
    $_: "$_" in initialAppContext ? initialAppContext.$_ : NotResolved,
    [RETURN_VALUE]: RETURN_VALUE in initialAppContext ? initialAppContext[RETURN_VALUE] : NotResolved
  };
  const nodes = flattenFxNode(flow);
  // idを持つノードのために、ローカルレコードにエントリーを予約する
  nodes.filter((n)=>n.id).forEach((n) => localRecord["#"+n.id!] = n.type === "context" ? n : NotResolved);
  
  // 受け取り済みのコンテキストにidレコードの参照を紐づけたProxyコンテキストを生成
  const appContext = createProxyContext(initialAppContext, localRecord);

  // 未定義のキー参照を調べる
  const missingKeys : string[] = nodes.flatMap((n)=>Object.values(n).filter((v) => isFxRef<unknown>(v) && !(v.key in appContext)).map((v)=>v.key));
  if (missingKeys.length) {
    throw blooky.error('dev-config', {
      code: 'MISSING_CONTEXT_KEYS',
      message: `コンテキストに必要なキーが不足しています: ${missingKeys.join(", ")}`,
      missingKeys,
      suggestions: [
        'fx-context の use 属性を確認してください',
        'コンテキストの初期化を確認してください',
        '参照されているすべてのキーが提供されていることを確認してください'
      ]
    });
  }

  // ノードツリー内で宣言済みのidだけを受け付けるよう、レコードを封印する
  Object.seal(localRecord);

  const cancelToken = createCancelToken();
  const execContext: ExecContext = {
    // FxRefを解決し、Prop（ゲッター関数）として正規化する
    resolve: (v:FxRef<any>) => resolveValue(v)(appContext),
    ...parentExecContext,
    // executionId: 親から継承されなければ新規生成（簡易カウンタ or timestamp）
    executionId: parentExecContext?.executionId ?? `exec-${Date.now()}-${Math.floor(Math.random()*1000)}`,
    cancelToken
  };
  return {
    rootNode: flow,
    execContext,
    appContext,
  };}

/**
 * 準備された副作用フローの実行を開始し、ExecutionHandleを同期的に返す。
 *
 * @param preparedFx prepare関数が返したオブジェクト
 * @returns ExecutionHandle
 */
function execute(preparedFx: PreparedFx): ExecutionHandle {
  const { rootNode, execContext, appContext } = preparedFx;

  const runtimeContext : Omit<FxExecutionContext,"node"> = {
    // ジェネレータの実行を開始する
    run(node:FxNode, context?: ExecContext) {
      return run.call(context || execContext, { ...runtimeContext, node })
    },
    // ジェネレータを最後まで実行し、Promise<AppContext>を返す
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
/**
 * フローを準備し、実行するショートカット関数。
 * @param node 実行するFxNode
 * @param app アプリケーションコンテキスト（オプション）
 * @param ctx 実行コンテキストの追加設定（オプション）
 * @returns ExecutionHandle
 */
const query = (node: FxNode, app?: AppContext, ctx?: ExecContext) => 
  execute(prepare(node, app || {}, ctx));

/**
 * `execute`のコアロジックを担うプライベートなヘルパー関数。ジェネレータを最後まで実行する。
 *
 * @param generator run関数が返したジェネレータ
 * @param ctx 実行コンテキスト
 * @returns フローの実行が完了したAppContext
 */
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
      // キャンセルされた場合は、ジェネレータを例外で終了させる
      generator.throw(FxCancelAsThrowable);
      break;
    }
    try {
      const definition = nodeDefinitionMap.get(node.type);
      if(!(definition))
        throw blooky.error("flow",{
          code: 'UNKNOWN_NODE_TYPE',
          message: `不明なfx-nodeタイプ(${node.type})`,
          nodeType: node.type,
          suggestions: ['ノード定義の登録を確認してください']
        });

      // 各ステップの情報をまとめたFxExecutionContextを生成
      const fxec: FxExecutionContext = { ...ctx, node };

      // ミドルウェアパイプラインの実行
      const runNextMiddleware = async (i: number): Promise<any> => {
        const middleware = allMiddlewares[i];
        return i === allMiddlewares.length
          ? await definition.handle(fxec) // 最後はノードハンドラを実行
          : middleware
          ? await middleware(fxec, () => runNextMiddleware(i + 1)) // ミドルウェアを実行し、next()で次へ進む
          : undefined;
      };
      nextValue = await runNextMiddleware(0);
    } catch (err) {
      let catcher: any = (node as any).catcher;

      // 1) 直接関数が指定されている場合はそのまま使う（最も簡潔）
      // 2) それ以外（FxRefなど）は execContext.resolve を通して解決する（戻りは Prop である可能性がある）
      if (typeof catcher !== "function" && catcher) {
        // this.resolve は FxRef を解決し、Prop または静的な値を返す
        catcher = this.resolve(catcher);
      }

      // `catcher` の挙動について:
      //  - 1. 直接エラーハンドラ関数として使用される (引数として (err) => ... を取る)
      //  - 2. または、Prop のようなゲッター関数として使用され (引数なしで呼び出され、非同期の可能性もある)、以下のいずれかを返す:
      //       * エラーハンドラ関数 (引数として (err) => ... を取る)
      //       * 次の値として使用するプレーンな値
      if (typeof catcher === "function") {
        try {
          // catcherがProp/ゲッター (引数0) の場合、それを呼び出して解決済みの値を取得する。
          // エラーを待機しているハンドラ関数の場合は、次のステップで呼び出される。
          const maybeResolved = await (catcher.length === 0 ? catcher() : catcher);
          
          // 解決された値が関数の場合、それを実際のエラーハンドラとして扱う: エラーと共に呼び出す。
          if (typeof maybeResolved === "function") {
            console.warn(`[fx-effect] Action failed, but was handled by context.`, maybeResolved);
            nextValue = await maybeResolved(err);
          } else {
            // 関数以外に解決された場合: それを回復値として扱い、フローを再開する。
            console.warn(`[fx-effect] Action failed, recovered with context-provided value.`, maybeResolved);
            nextValue = maybeResolved;
          }
        } catch (handlerErr) {
          // キャッチャー自体の呼び出しが失敗した場合、ポリシーに基づいて元のエラーまたはハンドラのエラーを伝播する。
          console.error(`[fx-effect] Error while invoking catcher:`, handlerErr);
          throw handlerErr;
        }
      } else {
        console.error(`[fx-effect] Unhandled error: Catch handler not found in context.`);
        // 処理できない場合は元のエラーを再スロー
        throw err;
      }
    }

    // nodeにidがあれば、appContextに結果を反映(厳密には、Proxyしているidレコードにセット)
    if (node.id && ("#" + node.id) in ctx.appContext) {
      ctx.appContext["#" + node.id] = nextValue;
    }
    
    // メインスレッドに処理を譲る
    await yieldToMainThread();
    result = generator.next(nextValue);
  }
  // 実行完了後のappContextを返す
  return ctx.appContext;
}

// ステップをCANCELするためのシンボル
const FxCancelAsThrowable = Symbol("FX_CANCEL");

/**
 * フローを辿るジェネレータを返すランナー関数。
 * @param ctx 実行コンテキスト
 * @returns FxNodeをyieldするジェネレータ
 */
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
    // キャンセルシンボルがスローされた場合は、結果として"canceled"を渡す
    if(err === FxCancelAsThrowable) {
      this.onNodeExit?.(node, "canceled");
    }
    // エラーで完了した場合、onNodeExit フックにエラー情報を渡す
    else if(err instanceof Error) {
      this.onNodeExit?.(node, undefined, err);
      throw err; // エラーは再スローする
    }
  }
}



/**
 * 現在の処理を一旦中断し、後続の処理を新しいマイクロタスクとして予約するPromiseを返す。
 * これにより、メインスレッドに一度処理を「譲る」ことができる。
 * @returns 解決済みのPromise
 */
function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    // 次のマイクロタスクとして予約する
    queueMicrotask(resolve);
  });
}

/**
 * アプリケーションコンテキスト（appContext）とIDレコード（idRecord）を結合し、
 * IDレコードへの書き込みを許可するProxyコンテキストを生成するヘルパー関数。
 * @param appContext 元のアプリケーションコンテキスト
 * @param idRecord idを持つノードの結果を格納するレコード
 * @returns ProxyされたAppContext
 */
const createProxyContext = (appContext: AppContext, idRecord: { [key:string|symbol]: unknown }): AppContext => {
  return new Proxy(appContext, {
    get(target, key) {
      // idRecordにキーが存在すればそちらを優先
      if (key in idRecord) {
        return idRecord[key];
      }
      return Reflect.get(target, key);
    },
    // id参照の更新のみを受け付ける
    set(_,key,value) {
      if (key in idRecord) {
        idRecord[key] = value;
        return true;
      }
      // それ以外への書き込みは許可しない
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

/**
 * FxRef、Prop、または静的な値を、常にProp（ゲッター関数）に正規化するヘルパー関数。
 * @param value FxRefまたは値
 * @returns AppContextを受け取りProp（値を返す関数）を返す関数
 */
const resolveValue = <T>(value: FxRef<T>) => (context: AppContext) : Prop<T> => {
  if (isFxRef<T>(value)) { 
    // FxRefの場合、コンテキストから実際の値を取得
    value = context[value.key];
  }
  // 値がすでにProp（関数）であればそのまま返し、そうでなければ値を返す関数にラップする
  return typeof value === "function"
    ? value as Prop<T>
    : () => value as T;
}

/**
 * FxNodeツリーを展開して、全てのノードのリストを生成する。
 * @param n FxNode
 * @returns FxNodeの配列
 */
const flattenFxNode = (n:FxNode): FxNode[] => {
  const children = nodeDefinitionMap.get(n.type)!.getChildNodes(n);
  return children
    ? [n, ...children.flatMap(flattenFxNode)]
    : [n];
}


export {
  fx, isFxRef, ref,
  run,prepare,execute,query,createCancelToken,createProxyContext
}
