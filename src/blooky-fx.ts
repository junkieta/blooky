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
import type { ClockEffect, Prop } from "./blooky-types";

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
    
    // ノード定義の execute を呼ぶ
    const generator = definition.execute(ctx as any);
    
    try {
      for await (const step of generator) {
        console.log('[fx] executeNode: yielding step', ctx.node.type, step.phase);
        
        // キャンセルチェック
        if (ctx.cancelToken.cancelled()) {
          console.log('[fx] executeNode: cancelled');
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
        
        // 外側に yield
        yield step;
        
        // デバッガに通知
        if (ctx.debugController) {
          ctx.debugController.afterStep(ctx.node, step, ctx.executionId);
        }
      }
    } catch (error) {
      console.error('[fx] executeNode: error', ctx.node.type, error);
      throw error;
    }
    
    console.log('[fx] executeNode: complete', ctx.node.type);
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

      console.log(`[fx] execute: step ${stepCount}`, step.phase, step.visual?.label);
      lastStep = step;
    }
    
    // ノードの id があれば appContext に結果を保存
    if (rootNode.id && lastStep?.data?.result !== undefined) {
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

export {
  fx, isFxRef, ref,
  prepare, execute, query,
  createCancelToken
};