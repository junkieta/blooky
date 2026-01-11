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
  FxRef
} from "./fx/types";
import type { Prop } from "./blooky-types";

// ─── 時間制御（旧 ft の内容）───
import { stream, collapse as coreCollapse, drip, DripEffect, hold } from './blooky-fp';

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
        if(!tickQueue.length) return;
        clockRunning = 0;
        const reservations = tickQueue.splice(0).reverse();
        const clockEffect = drip(t)(beat$);
        coreCollapse(clockEffect);
        reservations.forEach((r) => r.resolve(clockEffect));
        advanceClock();
    });
}

const tick = (effect:DripEffect<any>) => 
    new Promise((resolve,reject) => {
        tickQueue.push({ effect, resolve, reject });
        advanceClock();
    });

const clock = hold(0)(beat$);

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

// ─── CancelToken 生成 ───
function createCancelToken(parent?: CancelToken): CancelToken {
  let isCancelled = false;
  return {
    parent,
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled || (parent ? parent.cancelled() : false),
  }
}

// ─── prepare: 実行準備 ───
function prepare(
  flow: FxNode,
  initialAppContext: AppContext,
  parentExecContext?: Partial<ExecContext>
): PreparedFx {
  const appContext = { ...initialAppContext };
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
    
    // ノード定義の execute を呼ぶ
    const generator = definition.execute(ctx as any);
    
    try {
      for await (const step of generator) {
        // キャンセルチェック
        if (ctx.cancelToken.cancelled()) {
          throw new Error('Execution cancelled');
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
        
        // 外側に yield（親ノードやデバッガが観測可能）
        yield step;
        
        // デバッガに通知
        if (ctx.debugController) {
          ctx.debugController.afterStep(ctx.node, step, ctx.executionId);
        }
      }
    } catch (error) {
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
    
    // generator の return 値を返す
    const finalResult = await generator.next();
    return finalResult.value;
  };
  
  // ルートノードの実行を開始
  const rootCtx = createExecutionContext(rootNode, execContext.executionId || 'root');
  const rootGenerator = executeNode(rootCtx);
  
  // 非同期で実行を進める
  const done = (async () => {
    let lastStep;
    for await (const step of rootGenerator) {
      lastStep = step;
    }
    
    // ノードの id があれば appContext に結果を保存
    if (rootNode.id && lastStep?.data?.result !== undefined) {
      appContext["#" + rootNode.id] = lastStep.data.result;
    }
    
    return appContext;
  })();
  
  return {
    cancel: () => execContext.cancelToken.cancel(),
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

export {
  fx, isFxRef, ref,
  prepare, execute, query,
  createCancelToken
};