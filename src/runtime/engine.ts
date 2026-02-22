import type {
  FxNote,
  AppContext,
  ExecContext,
  PreparedFx,
  ExecutionHandle,
  ExecutionStep,
  CancelToken,
  FxRef,
  FxRefSymbol as FxRefSymbolDec,
  FxRefKey
} from "../blooky-fx-types";
import { RETURN_VALUE } from "../blooky-fx";
import type { Registry, PerfCtx, SemanticEvent, StepSink, YieldConditionRefV1 } from "./registry";
import type { RunnerProfile } from "./profile";
import { Prop } from "../blooky-fp-types";

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

const createProxyContext = (appContext: AppContext, idRecord: Record<string | symbol, any>): AppContext =>
  new Proxy(appContext, {
    get(target, key) {
      if (key in idRecord) return idRecord[key as any];
      return Reflect.get(target, key);
    },
    set(_, key, value) {
      if (key in idRecord) {
        idRecord[key as any] = value;
        return true;
      }
      return false;
    },
    has(target, key) {
      return key in idRecord || Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(idRecord)])];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key in idRecord) {
        return { value: idRecord[key as any], enumerable: true, writable: true, configurable: true };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });


export const FxRefSymbol = Symbol("FxRefSymbol") as typeof FxRefSymbolDec;
export const isFxRefKey = (v: unknown): v is FxRefKey =>
  !!v && typeof v === "object" && (v as any)[FxRefSymbol] === true && typeof (v as any).key === "string";


/**
 * 最低限のデフォルト resolver（resolveValue を切り離すため）
 * - FxRefKey: appContext[key]
 * - Prop: callable をそのまま
 * - value: 定数
 */
const defaultResolve = <T>(ref: FxRef<T>, appContext: AppContext): Prop<T> => {
  // Prop<T> は callable を想定
  if (typeof ref === "function") return ref as any;

  // FxRefKey
  if (ref && typeof ref === "object" && (ref as any)[FxRefSymbol] === true && typeof (ref as any).key === "string") {
    const k = (ref as any).key;
    return (() => (appContext as any)[k]) as any;
  }

  // constant
  return (() => ref as T) as any;
};

export function prepare(flow: FxNote, initialAppContext: AppContext, parent?: Partial<ExecContext>): PreparedFx {
  const localRecord: Record<string | symbol, any> = {
    $_: "$_" in (initialAppContext as any) ? (initialAppContext as any).$_ : NotResolved,
    [RETURN_VALUE]: RETURN_VALUE in (initialAppContext as any) ? (initialAppContext as any)[RETURN_VALUE] : NotResolved,
  };

  flatten(flow).forEach((n) => {
    if (!n.id) return;
    localRecord["#" + n.id] = NotResolved;
  });

  const appContext = createProxyContext(initialAppContext, localRecord);
  const cancelToken = createCancelToken(parent?.cancelToken);

  const execContext: ExecContext = {
    resolve:
      parent?.resolve ??
      (<T,>(ref: FxRef<T>) => defaultResolve(ref, appContext)),
    cancelToken,
    executionId: parent?.executionId ?? `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    onStep: parent?.onStep,
  };

  return { rootNote: flow, execContext, appContext };
}

export function execute(args: {
  prepared: PreparedFx;
  registry: Registry;
  profile: RunnerProfile;
}): ExecutionHandle {
  const { prepared, registry, profile } = args;
  const { rootNote, execContext, appContext } = prepared;

  const emit = (step: ExecutionStep) => {
    const onStep = execContext.onStep;
    if (!onStep) return;
    try {
      const maybePromise = onStep(step);
      if (
        maybePromise &&
        typeof (maybePromise as any).then === "function" &&
        typeof (maybePromise as any).catch === "function"
      ) {
        (maybePromise as Promise<unknown>).catch((e) => {
          console.error("[runner] onStep async error (isolated)", e);
        });
      }
    } catch (e) {
      console.error("[runner] onStep error (isolated)", e);
    }
  };

  const run = async (
    note: FxNote,
    parentId: string,
    appCtx: Record<string | symbol, any>,
    cancelToken: CancelToken
  ): Promise<unknown> => {
    const ctx: PerfCtx = { note, appContext: appCtx, executionId: `${parentId}:${note.type}` };

    const fsm = new RunnerFSM();
    emit({ phase: "enter", note: note, data: { executionId: ctx.executionId } });
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
          emit,
        });

        emit({ phase: "exit", note: note, data: { result: value } });
        if (note.id) (ctx.appContext as any)["#" + note.id] = value;
        return value;
      }

      const sem = registry.semantics.get(note.type);
      if (!sem) throw new Error(`No semantics for ${note.type}`);

      let final: unknown = undefined;

      for (const ev of sem(note, ctx)) {
        fsm.onEvent(ev);

        const r = await dispatchEvent(ev, {
          profile,
          ctx,
          cancelToken,
          emit,
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

      emit({ phase: "exit", note: note, data: { result: final } });
      if (note.id) (ctx.appContext as any)["#" + note.id] = final;
      return final;
    } catch (e) {
      if (e instanceof Terminated) {
        emit({ phase: "exit", note: note, data: { result: e.value, terminated: true } });
        if (note.id) (ctx.appContext as any)["#" + note.id] = e.value;
        throw e;
      }

      if (e instanceof Cancelled) {
        fsm.onCancel();
        emit({ phase: "cancel", note: note, data: { reason: e.reason } });
        throw e;
      }

      if (isCancelledError(e)) {
        const reason = cancelledReasonFromError(e);
        fsm.onCancel();
        emit({ phase: "cancel", note: note, data: { reason } });
        throw new Cancelled(reason);
      }

      throw e;
    }
  };

  const done = (async () => {
    let finalValue: unknown = undefined;

    try {
      finalValue = await run(rootNote, execContext.executionId || "root", appContext, execContext.cancelToken);
    } catch (e) {
      if (e instanceof Terminated) {
        finalValue = e.value;
      } else {
        throw e;
      }
    }

    (appContext as any)[RETURN_VALUE] = finalValue;
    if (rootNote.id) (appContext as any)["#" + rootNote.id] = finalValue;
    return appContext;
  })();

  return {
    cancel: () => execContext.cancelToken.cancel("user"),
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

const isYieldV1 = (u: unknown): u is YieldConditionRefV1 =>
  !!u && typeof u === "object" && (u as any).kind === "yield-v1";

const dispatchEvent = async (ev: SemanticEvent, deps: DispatchDeps) => {
  if (deps.cancelToken.cancelled()) throw new Cancelled(deps.cancelToken.reason ?? "user");

  switch (ev.type) {
    case "effect": {
      const projected = deps.profile.projectEffect(ev.ref, deps.ctx);
      deps.emit({ phase: "effect", note: deps.ctx.note, data: projected });

      const applied = await deps.profile.applyEffect(ev.ref, deps.ctx);
      if (applied.kind === "result") {
        deps.emit({ phase: "result", note: deps.ctx.note, data: { value: applied.value } });
        return { kind: "result" as const, value: applied.value };
      }
      return { kind: "continue" as const };
    }

    case "suspend": {
      // yield-v1 専用
      if (!isYieldV1(ev.until)) throw new Error("Unsupported suspend condition (expected yield-v1)");
      deps.emit({ phase: "suspend", note: deps.ctx.note, data: { until: ev.until } });

      const session = await deps.profile.startYield(ev.until, deps.ctx);
      await deps.profile.awaitYield(session, deps.ctx, deps.cancelToken);
      const value = await deps.profile.getYieldResult(session, deps.ctx);

      deps.emit({ phase: "resume", note: deps.ctx.note, data: { until: ev.until } });
      deps.emit({ phase: "result", note: deps.ctx.note, data: { value } });

      return { kind: "result" as const, value };
    }

    case "result":
      {
        const value = deps.profile.resolveRef(ev.value as FxRef<unknown>, deps.ctx);
        deps.emit({ phase: "result", note: deps.ctx.note, data: { value } });
        return { kind: "result" as const, value };
      }

    case "terminate":
      {
        const value = deps.profile.resolveRef(ev.value as FxRef<unknown>, deps.ctx);
        deps.emit({ phase: "terminate", note: deps.ctx.note, data: { value } });
        throw new Terminated(value);
      }
  }
};

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

