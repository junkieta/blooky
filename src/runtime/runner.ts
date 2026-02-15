import type {
  FxNote,
  AppContext,
  ExecContext,
  PreparedFx,
  ExecutionHandle,
  ExecutionStep,
  CancelToken,
  FxRef
} from "../fx/types";
import { RETURN_VALUE } from "../fx/nodes/return";
import type { Registry, PerfCtx } from "./registry";
import type { RunnerProfile } from "./profile";
import { RunnerFSM } from "./fsm";
import { dispatchEvent, Terminated, Cancelled } from "./dispatcher";
import { FxRefSymbol } from "../fx/types";
import { Prop } from "../blooky-types";

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
    middlewares: parent?.middlewares,
    debugController: parent?.debugController,
  };

  return { rootNode: flow, execContext, appContext };
}

export function execute(args: {
  prepared: PreparedFx;
  registry: Registry;
  profile: RunnerProfile;
}): ExecutionHandle {
  const { prepared, registry, profile } = args;
  const { rootNode, execContext, appContext } = prepared;

  const emit = (step: ExecutionStep) => {
    execContext.onStep?.(step);
  };

  const run = async (
    note: FxNote,
    parentId: string,
    appCtx: Record<string | symbol, any>,
    cancelToken: CancelToken
  ): Promise<unknown> => {
    const ctx: PerfCtx = { note, appContext: appCtx, executionId: `${parentId}:${note.type}` };

    const fsm = new RunnerFSM();
    emit({ phase: "enter", node: note, data: { executionId: ctx.executionId } });
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

        emit({ phase: "exit", node: note, data: { result: value } });
        if (note.id) (ctx.appContext as any)["#" + note.id] = value;
        return value;
      }

      const sem = registry.semantics.get(note.type);
      if (!sem) throw new Error(`No semantics for ${note.type}`);

      let final: unknown = undefined;
      let hasFinal = false;
      let pendingResult: { has: boolean; value: unknown } = { has: false, value: undefined };

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
          if (ev.type === "result") {
            final = r.value;
            hasFinal = true;
            break;
          }
          pendingResult = { has: true, value: r.value };
        }
      }

      if (!hasFinal && pendingResult.has) {
        fsm.onEvent({ type: "result", value: pendingResult.value });
        final = pendingResult.value;
      }

      emit({ phase: "exit", node: note, data: { result: final } });
      if (note.id) (ctx.appContext as any)["#" + note.id] = final;
      return final;
    } catch (e) {
      if (e instanceof Terminated) {
        emit({ phase: "exit", node: note, data: { terminated: true, value: e.value } });
        if (note.id) (ctx.appContext as any)["#" + note.id] = e.value;
        throw e;
      }

      if (e instanceof Cancelled) {
        fsm.onCancel();
        emit({ phase: "cancel", node: note, data: { reason: e.reason } });
        throw e;
      }

      if (isCancelledError(e)) {
        const reason = cancelledReasonFromError(e);
        fsm.onCancel();
        emit({ phase: "cancel", node: note, data: { reason } });
        throw new Cancelled(reason);
      }

      throw e;
    }
  };

  const done = (async () => {
    let finalValue: unknown = undefined;

    try {
      finalValue = await run(rootNode, execContext.executionId || "root", appContext, execContext.cancelToken);
    } catch (e) {
      if (e instanceof Terminated) {
        finalValue = e.value;
      } else {
        throw e;
      }
    }

    (appContext as any)[RETURN_VALUE] = finalValue;
    if (rootNode.id) (appContext as any)["#" + rootNode.id] = finalValue;
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
