import type {
  FxNote,
  AppContext,
  FxRuntime,
  PreparedFx,
  ExecutionHandle,
  ExecutionStep,
  CancelToken,
  FxRef,
  FxRefSymbol as FxRefSymbolDec,
  FxRefKey,
  StepObserver,
  Registry,
  PerfCtx,
  SemanticEvent,
  StepSink,
  YieldConditionRef,
  RunnerProfile,
  FxCallAction
} from "../blooky-fx-types";
import { Prop } from "../blooky-fp-types";
import { decode, bind } from "../blooky-context";

const NotResolved = Symbol.for("NotResolved");

const isCancelledError = (e: unknown): e is Error =>
  e instanceof Error && e.message.startsWith("cancelled:");

const cancelledReasonFromError = (e: Error) => e.message.slice("cancelled:".length) || "user";

function createCancelToken(parent?: CancelToken): CancelToken {
  let isCancelled = false;
  let cancelReason: any;
  return {
    parent,
    cancel: (reason: any = "user") => {
      isCancelled = true;
      cancelReason = reason;
    },
    cancelled: () => isCancelled || !!parent?.cancelled(),
    get reason() {
      if (isCancelled) return cancelReason;
      return parent?.reason;
    },
  };
}

export const FxRefSymbol = Symbol("FxRefSymbol") as typeof FxRefSymbolDec;
export const isFxRefKey = (v: unknown): v is FxRefKey =>
  !!v &&
  typeof v === "object" &&
  (v as any)[FxRefSymbol] === true &&
  typeof (v as any).key === "string";

export const isFxCallActionObject = (v: unknown): v is FxCallAction => 
  !!v && (typeof v === "object" && typeof (v as FxCallAction).call === "function");


/**
 * 最低限のデフォルト resolver（resolveValue を切り離すため）
 * - FxRefKey: decode(appContext, {kind:"ctx", key})
 * - Prop: callable をそのまま
 * - value: 定数
 */
const defaultResolve = <T>(ref: FxRef<T>, ctx: PerfCtx): Prop<T> => {
  if (isFxRefKey(ref)) {
    const k = ref.key;
    if(k.startsWith("#") || k.startsWith("$_"))
      return () => ctx.runtime.idSlots[k] ?? (typeof document !== "undefined" ? document.getElementById(k.slice(1)) : null);
    const v = decode(ctx.appContext as any, { kind: "ctx", key: k }) as FxRef<T>;
    return defaultResolve(v, ctx);
  }
  
  if (typeof ref === "function")
    return ref as any;
  
  const p = () => ref as T;
  return isFxCallActionObject(ref)
    ? Object.assign(p, { FX_CALL_ACTION_PROP: true })
    : p;
};

export function prepare(flow: FxNote, initialAppContext: AppContext = {}, parent?: Partial<FxRuntime>): PreparedFx {

  const idSlots: Record<string, any> = Object.create(parent?.idSlots ?? null);

  flatten(flow).forEach((n) => {
    if (n.id) idSlots["#" + n.id] = NotResolved;
  });

  // 書き込みはツリー内のid情報に基づいたキーだけに閉じる
  Object.seal(idSlots);

  const cancelToken = createCancelToken(parent?.cancelToken);
  const runtime: FxRuntime = {
    resolver: parent?.resolver ?? defaultResolve,
    cancelToken,
    idSlots,
    executionId: parent?.executionId ?? `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };

  const names = Object.getOwnPropertyNames(initialAppContext);
  const descriptors = names.reduce((descs, name)=>{
    descs[name] = {
      value: initialAppContext[name],
      writable: false,
      enumerable: true,
      configurable: false,
    };
    return descs;
  }, {} as PropertyDescriptorMap);
  
  const appContext = Object.create(null, descriptors);

  names.forEach((key)=>bind(appContext, key, appContext[key]));

  return { rootNote: flow, runtime, appContext };
}

export function execute(args: {
  prepared: PreparedFx;
  registry: Registry;
  profile: RunnerProfile;
}): ExecutionHandle {
  const { prepared, registry, profile } = args;
  const { rootNote, runtime: execContext, appContext } = prepared;

  const stepObservers = new Set<StepObserver>();
  const notifyStep = notifyStepObserver(stepObservers);

  const run = async (
    note: FxNote,
    parentId: string,
    appCtx: Record<string, any>,
    cancelToken: CancelToken
  ): Promise<unknown> => {
    const ctx: PerfCtx = {
      note,
      runtime: execContext,
      appContext: appCtx,
      executionId: `${parentId}:${note.type}`
    };

    const fsm = new RunnerFSM();
    notifyStep({ phase: "enter", note: note, data: { executionId: ctx.executionId } });
    fsm.onEnter();

    try {
      if (cancelToken.cancelled()) {
        throw new Cancelled(cancelToken.reason ?? "user");
      }

      const struct = registry.structures.get(note.type);
      if (struct) {
        const value = await struct(note, ctx, {
          runChild: (child, overrideAppContext, overrideCancelToken) =>
            run(
              child,
              ctx.executionId,
              overrideAppContext ?? ctx.appContext,
              overrideCancelToken ?? cancelToken
            ),
          profile,
          cancelToken,
        });

        notifyStep({ phase: "exit", note: note, data: { result: value } });
        await profile.applyExitBoundary(note, ctx, value);
        return value;
      }

      const sem = registry.semantics.get(note.type);
      if (!sem) throw new Error(`No semantics for ${note.type}`);

      let final: unknown = undefined;
      for (const ev of sem(note, ctx)) {
        fsm.onEvent(ev);

        const r = await dispatchSemEvent(ev, {
          profile,
          ctx,
          cancelToken,
          emit: notifyStep,
        });

        if (ev.type === "suspend") {
          fsm.onResume();
        }

        if (r.kind === "result") {
          if (ev.type !== "result") {
            fsm.onEvent({ type: "result", value: r.value });
          }
          final = r.value;
        }
      }

      notifyStep({ phase: "exit", note: note, data: { result: final } });
      // note と note の間（exit直後）で done 境界処理
      await profile.applyExitBoundary(note, ctx, final);
      return final;
    } catch (e) {
      if (e instanceof Terminated) {
        notifyStep({ phase: "exit", note: note, data: { result: e.value, terminated: true } });
        await profile.applyExitBoundary(note, ctx, e.value);
        throw e;
      }

      if (e instanceof Cancelled) {
        fsm.onCancel();
        notifyStep({ phase: "cancel", note: note, data: { reason: e.reason } });
        throw e;
      }

      if (isCancelledError(e)) {
        const reason = cancelledReasonFromError(e);
        fsm.onCancel();
        notifyStep({ phase: "cancel", note: note, data: { reason } });
        throw new Cancelled(reason);
      }

      throw e;
    }
  };

  const done = new Promise((resolve,reject)=>{
    queueMicrotask(() => {
      (async () => {
        let finalValue: unknown = undefined;

        try {
          finalValue = await run(rootNote, execContext.executionId || "root", appContext, execContext.cancelToken);
        } catch (e) {
          if (e instanceof Terminated) {
            finalValue = e.value;
          } else {
            reject(e);
            return;
          }
        }

        if (rootNote.id) execContext.idSlots["#" + rootNote.id] = finalValue;
        resolve(finalValue);
      })().catch(reject);
    });
  });

  return {
    cancel: () => execContext.cancelToken.cancel("user"),
    observeStep: (fn:StepObserver) => {
      stepObservers.add(fn);
      return () => stepObservers.delete(fn);
    },
    done,
  };
}

function flatten(n: FxNote): FxNote[] {
  switch (n.type) {
    case "sequence":
    case "parallel":
    case "race":
      return [n, ...n.steps.flatMap(flatten)];

    case "loop":
      return [n, ...flatten(n.body)];

    case "condition":
      return [n, ...flatten(n.then), ...(n.else ? flatten(n.else) : [])];

    case "switch":
      return [n, ...[...n.cases.values()].flatMap(flatten), ...(n.default ? flatten(n.default) : [])];

    case "context":
      return [n, ...flatten(n.child)];

    default:
      return [n];
  }
}

export class Terminated extends Error {
  readonly name = "Terminated";
  constructor(readonly value: unknown) {
    super("Performance terminated");
  }
}

export class Cancelled extends Error {
  readonly name = "Cancelled";
  constructor(readonly reason: string) {
    super(`Execution cancelled: ${reason}`);
  }
}

export type DispatchDeps = {
  profile: RunnerProfile;
  ctx: PerfCtx;
  cancelToken: CancelToken;
  emit: StepSink;
};

const dispatchSemEvent = async (ev: SemanticEvent, deps: DispatchDeps) => {
  if (deps.cancelToken.cancelled()) throw new Cancelled(deps.cancelToken.reason ?? "user");

  switch (ev.type) {

    case "effect": {
      const projected = deps.profile.projectEffect(ev.ref, deps.ctx);
      deps.emit({ phase: "effect", note: deps.ctx.note, data: projected });

      const value = await deps.profile.applyEffect(ev.ref, deps.ctx);
      if (value.kind === "none") return { kind: "continue" as const };
      deps.emit({ phase: "result", note: deps.ctx.note, data: { value } });
      return { kind: "result" as const, value };
    }

    case "suspend": {
      deps.emit({ phase: "suspend", note: deps.ctx.note, data: { until: ev.until } });

      const out = await deps.profile.awaitSuspend(ev.until, deps.ctx, deps.cancelToken);
      deps.emit({ phase: "resume", note: deps.ctx.note, data: { until: ev.until } });

      if (out.kind === "continue") return out;

      deps.emit({ phase: "result", note: deps.ctx.note, data: { value: out } });
      return { kind: "result" as const, value: out };
    }

    case "result":
      {
        const value = deps.ctx.runtime.resolver(ev.value as FxRef<unknown>, deps.ctx)();
        deps.emit({ phase: "result", note: deps.ctx.note, data: { value } });
        return { kind: "result" as const, value };
      }

    case "terminate":
      {
        const value = deps.ctx.runtime.resolver(ev.value as FxRef<unknown>, deps.ctx)();
        deps.emit({ phase: "terminate", note: deps.ctx.note, data: { value } });
        throw new Terminated(value);
      }
  }
};

const notifyStepObserver = (observers: Set<StepObserver>) => (step: ExecutionStep) => {
  if (observers.size) observers.forEach((observer)=>{
    try {
      const maybePromise = observer(step);
      if (
        maybePromise &&
        typeof (maybePromise as any).then === "function" &&
        typeof (maybePromise as any).catch === "function"
      ) {
        (maybePromise as Promise<unknown>).catch((e) => {
          console.error("[runner] StepObserver async error (isolated)", e);
        });
      }
    } catch (e) {
      console.error("[runner] StepObserver error (isolated)", e);
    }
  })
}


type Phase = "enter" | "running" | "suspended" | "completed" | "terminated" | "cancelled";

class RunnerFSM {
  private phase: Phase = "enter";
  private sawResult = false;
  private sawTerminate = false;

  onEnter() {
    if (this.phase !== "enter") throw new Error("FSM violation: enter twice");
    this.phase = "running";
  }

  onEvent(ev: SemanticEvent) {
    if (this.phase === "completed" || this.phase === "terminated" || this.phase === "cancelled") {
      throw new Error(`FSM violation: event after end (${ev.type})`);
    }

    switch (ev.type) {
      case "effect":
        if (this.sawResult || this.sawTerminate) {
          throw new Error("FSM violation: effect after result/terminate");
        }
        return;

      case "suspend":
        if (this.sawResult || this.sawTerminate) {
          throw new Error("FSM violation: suspend after result/terminate");
        }
        if (this.phase !== "running") {
          throw new Error("FSM violation: suspend when not running");
        }
        this.phase = "suspended";
        return;

      case "result":
        if (this.sawTerminate) throw new Error("FSM violation: result with terminate");
        if (this.sawResult) throw new Error("FSM violation: duplicate result");
        this.sawResult = true;
        this.phase = "completed";
        return;

      case "terminate":
        if (this.sawResult) throw new Error("FSM violation: terminate with result");
        if (this.sawTerminate) throw new Error("FSM violation: duplicate terminate");
        this.sawTerminate = true;
        this.phase = "terminated";
        return;
    }
  }

  onResume() {
    if (this.phase !== "suspended") throw new Error("FSM violation: resume without suspend");
    this.phase = "running";
  }

  onCancel() {
    if (this.phase === "completed" || this.phase === "terminated" || this.phase === "cancelled") {
      throw new Error("FSM violation: cancel after end");
    }
    this.phase = "cancelled";
  }
}

