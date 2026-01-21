// src/blooky-fx.ts

import { nodeDefinitionMap } from "./fx/nodes";
import { blooky } from "./blooky-fp";
import type { 
  FxNode, 
  AppContext, 
  CancelToken, 
  ExecContext, 
  ExecutionContext, 
  ExecutionHandle, 
  PreparedFx, 
  FxFactoryMap,
  ExecutionStep,
  FxRef,
  CancelReason
} from "./fx/types";
import type { ClockEffect, Prop } from "./blooky-types";

// ─── 時間制御（旧 ft の内容）───
import { stream, collapse as coreCollapse, drip, DripEffect, hold } from './blooky-fp';
import { RETURN_VALUE } from "./fx/nodes/return";

const beat$ = stream<number>();
const scheduler = globalThis.requestAnimationFrame || 
  ((f:(t:number)=>void) => setTimeout(()=>f(performance.now()), Math.ceil(1000/60)));

type Reservation = {
  effect: DripEffect<any>
  resolve: (v:DripEffect<number>)=>void
  reject: (v:Error[])=>void
}
const tickQueue: Reservation[] = [];

let clockRunning: number | NodeJS.Timeout = 0;
const advanceClock = () => {
    if(!clockRunning) clockRunning = scheduler((t:number) => {
        if(!tickQueue.length && !clockObservers.size) return;
        clockRunning = 0;
        const reservations = tickQueue.splice(0).reverse();
        const clockEffect = drip(t)(beat$);
        const errors = notifyClockObservers(clockEffect)(reservations);
        coreCollapse(clockEffect);
        if(!errors.length) {
            reservations.forEach((r) => r.resolve(clockEffect));
        } else {
            reservations.forEach((r) => r.reject(errors));
        }
//        reservations.forEach((r) => r.resolve(clockEffect));
        advanceClock();
    });
}

const tick = (effect:DripEffect<any>) => 
    new Promise((resolve,reject) => {
        tickQueue.push({ effect, resolve, reject });
        advanceClock();
    });

const clockObservers = new Map<(effect: ClockEffect) => void, Set<Prop<unknown>>>();

type Clock = Prop<number> & {
    observe: (f:(effect:ClockEffect)=>void) => (p: Prop<unknown>) => ()=>void
    unobserve: (f:(effect:ClockEffect)=>void) => (p?: Prop<unknown>) => void
};

const clock = Object.assign(hold(0)(beat$), {

    observe: (f:(effect:ClockEffect)=>void) => (p: Prop<unknown>) => {
        if(!clockObservers.has(f)) 
            clockObservers.set(f, new Set([p]));
        else
            clockObservers.get(f)!.add(p);
        return clock.unobserve(f).bind(null, p);
    },

    unobserve: (f:(effect:ClockEffect)=>void) => (p?: Prop<unknown>) => {
        if(!clockObservers.has(f)) return;
        if(!p) {
            clockObservers.delete(f)
        } else {
            const props = clockObservers.get(f)!;
            props.delete(p);
            if(!props.size)
                clockObservers.delete(f);
        }
    }

}) as Clock;

const notifyClockObservers = (effect: DripEffect<any>) => (reservations: Reservation[]) : Error[] => {
    const propEffects = effect.effects;
    reservations.forEach((r) => {
        r.effect.effects.forEach((v,p) => {
            if(!propEffects.has(p))
                propEffects.set(p,v);
        });
    });

    const errors: Error[] = [];
    clockObservers.forEach((props,f) => {
        const m = new Map(propEffects.entries().filter(([p])=>props.has(p)));
        if(m.size) {
            try {
                f(Object.assign({}, effect, {
                    effects: m,
                    unbind: clock.unobserve(f)
                }));
            } catch(err) {
                errors.push(err);
            }
        }
    });
    return errors;
}

export const time = { tick, clock };

// ─── FxNode ファクトリ ───
const fx = {} as FxFactoryMap;
nodeDefinitionMap.forEach((def, type) => {
  (fx as any)[type] = def.factory.bind(def);
});

// ─── FxRef 参照オブジェクト ───
const FxRefSymbol = Symbol("FxRef");
const ref = <T>(key: string): FxRef<T> => ({ [FxRefSymbol]: true, key });
const isFxRef = <T>(v: unknown): v is Extract<FxRef<T>, ({ [K in typeof FxRefSymbol]: true; } & { key: string; })> => 
  v && (v as any)[FxRefSymbol] === true;


const NotResolved = Symbol.for("NotResolved");

// ─── CancelToken 生成 ───
// src/blooky-fx.ts

function createCancelToken(parent?: CancelToken): CancelToken {
  let isCancelled = false;
  let cancelReason: CancelReason | undefined;
  
  return {
    parent,
    cancel: (reason: CancelReason = 'user') => { 
      isCancelled = true;
      cancelReason = reason;
    },
    cancelled: () => isCancelled || (parent ? parent.cancelled() : false),
    get reason() {
      if (isCancelled) return cancelReason;
      if (parent?.cancelled()) return parent.reason;
      return undefined;
    }
  }
}
// ─── prepare: 実行準備 ───

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

  const cancelToken = createCancelToken();
  const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const execContext: ExecContext = {
    resolve: (v: FxRef<any>) => resolveValue(v)(appContext),
    ...parentExecContext,
    cancelToken,
    executionId
  };
  
  return {
    rootNode: flow,
    execContext,
    appContext,
  };
}

// ─── execute: 実行開始 ───
function execute(preparedFx: PreparedFx): ExecutionHandle {
  const { rootNode, execContext, appContext } = preparedFx;
  console.log('[fx] execute: starting', { rootNode, executionId: execContext.executionId });  
  
  // ExecutionContext 生成ヘルパー
  const createExecutionContext = (node: FxNode, parentId: string): ExecutionContext => {
    const executionId = `${parentId}:${node.type}`;
    
    return {
      node,
      appContext,
      executionId,
      resolve: (ref) => execContext.resolve(ref),
      executeChild: (child) => {
        const childCtx = createExecutionContext(child, executionId);
        return executeNode(childCtx);
      },
      debugController: execContext.debugController,
      cancelToken: execContext.cancelToken,
      middlewares: execContext.middlewares,
      onStep: execContext.onStep
    };
  };
  
  // ノードの実行（generator を駆動）
  const executeNode = async function*(
    ctx: ExecutionContext
  ): AsyncGenerator<ExecutionStep, any, any> {
    const definition = nodeDefinitionMap.get(ctx.node.type);
    if (!definition) {
      throw blooky.error("flow", {
        code: 'UNKNOWN_NODE_TYPE',
        message: `Unknown node type: ${ctx.node.type}`,
        nodeType: ctx.node.type,
        suggestions: ['Check that all node types are registered']
      });
    }
    
    console.log('[fx] executeNode: start', ctx.node.type, ctx.executionId);
    
    const generator = definition.execute(ctx as any);
    let finalValue: any; //  最終的な戻り値を保存
    
    try {
      for await (const step of generator) {
        console.log('[fx] executeNode: yielding step', ctx.node.type, step.phase);
        
        // キャンセルチェック
        if (ctx.cancelToken.cancelled()) {
          const reason = ctx.cancelToken.reason;
          console.log('[fx] executeNode: cancelled', { reason, nodeType: ctx.node.type });
          
          // 🆕 fx-return によるキャンセルは正常終了として扱う
          if (reason === 'return') {
            console.log('[fx] executeNode: normal completion via fx-return');
            return; // エラーを throw しない
          }
          
          // その他のキャンセルはエラー
          throw new Error(`Execution cancelled: ${reason}`);
        }
        
        // デバッガに通知
        if (ctx.debugController) {
          await ctx.debugController.beforeStep(ctx.node, step, ctx.executionId);
        }
        
        // ミドルウェア実行
        if (ctx.middlewares) {
          for (const middleware of ctx.middlewares) {
            await middleware({ step, node: ctx.node, executionId: ctx.executionId }, async () => {});
          }
        }
        
        // onStep コールバック
        if (ctx.onStep) {
          ctx.onStep(step);
        }
        
        // 外側に yield
        yield step;
        
        // デバッガに通知
        if (ctx.debugController) {
          ctx.debugController.afterStep(ctx.node, step, ctx.executionId);
        }

      }

      // 🆕 generator の return 値を取得
      const finalResult = await generator.next();
      finalValue = finalResult.value;

    } catch (error) {
      console.error('[fx] executeNode: error', ctx.node.type, {
        error,
        errorName: error?.constructor?.name,
        errorMessage: error?.message,
        cancelReason: ctx.cancelToken.reason
      });
      
      // 🆕 キャンセルエラーで、理由が 'return' なら再throw しない
      if (error?.message?.includes('Execution cancelled') && ctx.cancelToken.reason === 'return') {
        console.log('[fx] executeNode: suppressing cancel error (return)');
        return; // 正常終了
      }
      
      // エラーハンドリング
      let catcher = ctx.node.catcher;
      
      if (catcher && typeof catcher !== "function") {
        catcher = ctx.resolve(catcher);
      }
      
      if (typeof catcher === "function") {
        try {
          const maybeResolved = await (catcher.length === 0 ? (catcher as ()=>any)() : catcher);
          
          if (typeof maybeResolved === "function") {
            console.warn(`[fx] Action failed, but was handled by catcher.`);
            return await maybeResolved(error);
          } else {
            console.warn(`[fx] Action failed, recovered with provided value.`);
            return maybeResolved;
          }
        } catch (handlerErr) {
          console.error(`[fx] Error while invoking catcher:`, handlerErr);
          throw handlerErr;
        }
      } else {
        throw error;
      }
    }
    
    console.log('[fx] executeNode: complete', ctx.node.type);
    
    // id があれば appContext に保存
    if (ctx.node.id && finalValue !== undefined) {
      const key = "#" + ctx.node.id;
      console.log('[fx] executeNode: saving result to appContext', { key, finalValue });
      ctx.appContext[key] = finalValue;
    }

    return finalValue;

  };

  // ルートノードの実行を開始
  const rootCtx = createExecutionContext(rootNode, execContext.executionId || 'root');
  const rootGenerator = executeNode(rootCtx);

  console.log('[fx] execute: root generator created');  
  // 非同期で実行を進める
  const done = (async () => {
    console.log('[fx] execute: starting iteration');
    let lastStep;
    let stepCount = 0;
    for await (const step of rootGenerator) {
      stepCount++;
      console.log(`[fx] execute: step ${stepCount}`, step.phase, step.visual?.label);
      
      // appContext の変化を追跡
      if (step.phase === 'defined') {
        console.log('[fx] execute: appContext updated', Object.keys(appContext));
      }
      
      lastStep = step;
    }
    
    console.log('[fx] execute: completed', { stepCount, lastStep, appContext: appContext });
    
    if (rootNode.id && lastStep?.data?.result !== undefined) {
      console.log('[fx] executeNode: saving result to appContext', { key: rootNode.id, finalValue: lastStep.data.result });
      appContext["#" + rootNode.id] = lastStep.data.result;
    }
    
    return appContext;
  })();
  
  return {
    cancel: () => {
      console.log('[fx] execute: cancelled');
      execContext.cancelToken.cancel()
    },
    done
  };
}

// ─── query: prepare + execute のショートハンド ───
const query = (node: FxNode, app?: AppContext, ctx?: Partial<ExecContext>) => 
  execute(prepare(node, app || {}, ctx));

// ─── resolveValue: FxRef を Prop に正規化 ───
const resolveValue = <T>(value: FxRef<T>) => (context: AppContext): Prop<T> => {
  if (isFxRef<T>(value)) { 
    value = context[value.key];
  }
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
      // 重複を防ぐために一度Set化してから配列化
      return [...new Set([...Reflect.ownKeys(target), ...Object.keys(idRecord)])];
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


export {
  fx, isFxRef, ref,
  prepare, execute, query,
  createCancelToken
};