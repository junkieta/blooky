import type {
  FxNote,
  AppContext,
  ExecutionConfig,
  PreparedFx,
  ExecutionHandle,
  PerformanceStep,
  PerformanceStepDraft,
  CancelToken,
  FxRef,
  FxRefSymbol as FxRefSymbolDec,
  FxRefKey,
  Registry,
  ExecutionContext as ExecutionContext,
  RunnerProfile,
  FxCallAction
} from "../blooky-fx-types";
import { Prop } from "../blooky-fp-types";
import { decode, bind } from "../blooky-context";
import { stream } from "../blooky-fp";
import { clock } from "./clock";
import { createChildCancelToken, Cancelled } from "./cancel-token";
import { flattenFxNotes, resolveNoteId } from "./fx-tree";
import { runFxExecution } from "./generator-runner";

const NotResolved = Symbol.for("NotResolved");

const isCancelledError = (e: unknown): e is Error =>
  e instanceof Error && e.message.startsWith("cancelled:");

const cancelledReasonFromError = (e: Error) => e.message.slice("cancelled:".length) || "user";

// Use createChildCancelToken from registry.ts for consistency
const createCancelToken = createChildCancelToken;

// ExecutionConfig.idSlots の生成
const createIdSlots = (flow: FxNote, parentSlot?: Record<string, any>) => {
  // id - final value の slot
  const idSlots: Record<string, any> = {};
  // 親slotsからの指定があれば引き継ぐ(yield.inputは$_)
  if(parentSlot) {
    Object.assign(idSlots, parentSlot);
  }
  flattenFxNotes(flow).forEach((n) => {
    if (n.id) idSlots["#" + n.id] = NotResolved;
  });
  // 書き込みはツリー内のid情報に基づいたキーだけにこの時点で閉じる
  return Object.seal(idSlots);
}

const createAppContext = (initialAppContext: AppContext) => {
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
  return appContext;
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
const defaultResolve = <T>(ref: FxRef<T>, ctx: ExecutionContext): Prop<T> => {
  if (isFxRefKey(ref)) {
    const k = ref.key;
    if(k.startsWith("#") || k.startsWith("$_"))
      return () => ctx.config.idSlots[k] ?? (typeof document !== "undefined" ? document.getElementById(k.slice(1)) : null);
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

class ScoreValidationError extends Error {
  readonly name = "ScoreValidationError";
  constructor(message: string, readonly detail?: Record<string, unknown>) {
    super(message);
  }
}

const failValidation = (
  message: string,
  path: string,
  note: unknown
): never => {
  throw new ScoreValidationError(message, {
    path,
    noteType: (note as any)?.type ?? null,
    noteId: (note as any)?.id ?? null,
  });
};

const validateScore = (note: unknown, path: string): void => {
  if (!note || typeof note !== "object") {
    failValidation("FxNote must be an object", path, note);
  }

  const typed = note as any;
  if (typeof typed.type !== "string") {
    failValidation("FxNote.type must be a string", path, note);
  }
  if (typed.id !== undefined && typeof typed.id !== "string") {
    failValidation("FxNote.id must be a string when provided", path, note);
  }

  switch (typed.type as FxNote["type"]) {
    case "none":
      return;
    case "sequence":
    case "parallel":
    case "race":
      if (!Array.isArray(typed.steps)) {
        failValidation(`${typed.type}.steps must be an array`, path, note);
      }
      typed.steps.forEach((child: unknown, i: number) => validateScore(child, `${path}.steps[${i}]`));
      return;
    case "wait":
      const hasTimer = typeof typed.timer !== "undefined";
      const hasUntil = typeof typed.until !== "undefined";
      if (hasTimer === hasUntil) {
        failValidation("fx-wait requires exactly one of 'timer' or 'until'", path, note);
      }      
      return;
    case "loop":
      if (typed.cond === undefined) {
        failValidation("loop.cond is required", path, note);
      }
      if (typed.body === undefined) {
        failValidation("loop.body is required", path, note);
      }
      if (
        typed.maxIterations !== undefined &&
        (typeof typed.maxIterations !== "number" ||
          (!Number.isFinite(typed.maxIterations) && typed.maxIterations !== Infinity) ||
          typed.maxIterations < 0)
      ) {
        failValidation("loop.maxIterations must be a non-negative number or Infinity", path, note);
      }
      if (
        typed.maxDuration !== undefined &&
        (typeof typed.maxDuration !== "number" || !Number.isFinite(typed.maxDuration) || typed.maxDuration < 0)
      ) {
        failValidation("loop.maxDuration must be a non-negative finite number", path, note);
      }
      validateScore(typed.body, `${path}.body`);
      return;
    case "condition":
      if (typed.if === undefined) {
        failValidation("condition.if is required", path, note);
      }
      if (typed.then === undefined) {
        failValidation("condition.then is required", path, note);
      }
      validateScore(typed.then, `${path}.then`);
      if (typed.else !== undefined) validateScore(typed.else, `${path}.else`);
      return;
    case "switch":
      if (typed.by === undefined) {
        failValidation("switch.by is required", path, note);
      }
      if (!(typed.cases instanceof Map)) {
        failValidation("switch.cases must be a Map", path, note);
      }
      let caseIndex = 0;
      for (const [key, child] of typed.cases.entries()) {
        const keyType = typeof key;
        if (keyType !== "string" && keyType !== "number" && keyType !== "symbol") {
          failValidation("switch.cases key must be string | number | symbol", `${path}.cases[${caseIndex}]`, note);
        }
        validateScore(child, `${path}.cases[${String(key)}]`);
        caseIndex += 1;
      }
      if (typed.default !== undefined) validateScore(typed.default, `${path}.default`);
      return;
    case "call":
      if (typed.action === undefined) {
        failValidation("call.action is required", path, note);
      }
      return;
    case "yield":
      if (typed.score === undefined) {
        failValidation("yield.score is required", path, note);
      }
      return;
    case "flow":
      if (!typed.context || typeof typed.context !== "object" || Array.isArray(typed.context)) {
        failValidation("context.context must be an object", path, note);
      }
      if (typed.child === undefined) {
        failValidation("context.child is required", path, note);
      }
      validateScore(typed.child, `${path}.child`);
      return;
    case "return":
      return;
    default:
      failValidation(`Unsupported FxNote.type: ${String(typed.type)}`, path, note);
  }
};

export function prepare(flow: FxNote, initialAppContext: AppContext = {}, parent?: Partial<ExecutionConfig>): PreparedFx {
  validateScore(flow, "root");
  return {
    rootNote: flow,
    appContext: createAppContext(initialAppContext),
    config: {
      resolver: parent?.resolver ?? defaultResolve,
      idSlots: createIdSlots(flow, parent?.idSlots),
      executionId: parent?.executionId,
      cancelToken: parent?.cancelToken,
      stepObserver: parent?.stepObserver,
    },
  };
}

const EXISTING_EXEC_ID = new Set<string>("");
const generateExecutionId = (id?: string) : [string, ()=>void] => {
  let new_id: string;
  do new_id = `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  while(EXISTING_EXEC_ID.has(new_id));
  EXISTING_EXEC_ID.add(new_id);
  return [new_id, EXISTING_EXEC_ID.delete.bind(EXISTING_EXEC_ID, new_id)];
}

const resolveExitEffect = (note: FxNote, ctx: ExecutionContext, result: unknown) => {
  const done = (note as any).done;
  if (done === undefined) return undefined;
  const dripper = ctx.config.resolver(done as FxRef<unknown>, ctx)();
  const value = ctx.config.resolver(result as FxRef<unknown>, ctx)();
  return { kind: "done", dripper, value };
};

export function execute(args: {
  prepared: PreparedFx;
  registry: Registry;
  profile: RunnerProfile;
  onStep?: (step: PerformanceStep) => void | Promise<void>;
}): ExecutionHandle {
  const { prepared, registry, profile } = args;
  const { rootNote, config, appContext } = prepared;
  const onStep = args.onStep ?? config.stepObserver;
  config.stepObserver = onStep;
  const [ execution_id, unbind_exec_id] = generateExecutionId();
  const rootCancelToken = createCancelToken(config.cancelToken);

  let stepCount = 0;

  const run = async (
    note: FxNote,
    appContext: Record<string, any>,
    cancelToken: CancelToken,
    relay?: (step: PerformanceStep) => void | Promise<void>,
  ): Promise<unknown> => {

    const fsm = new RunnerFSM();
    const ctx: ExecutionContext = {
      note,
      cancelToken,
      config,
      appContext,
      executionId: execution_id,
      resolve: <T>(ref: FxRef<T>) => config.resolver(ref, ctx),
      executeChild: <Result>(
        child: FxNote,
        childAppContext = appContext,
        childCancelToken = cancelToken,
      ) => (async function* () {
        const queued: PerformanceStep[] = [];
        let finished = false;
        let wake: (() => void) | undefined;
        const notify = () => {
          const resolve = wake;
          wake = undefined;
          resolve?.();
        };
        const completion = run(child, childAppContext, childCancelToken, async (step) => {
          queued.push(step);
          notify();
        });
        completion.then(
          () => {
            finished = true;
            notify();
          },
          () => {
            finished = true;
            notify();
          },
        );

        while (!finished || queued.length > 0) {
          if (queued.length === 0) {
            await new Promise<void>((resolve) => { wake = resolve; });
          } else {
            yield queued.shift()!;
          }
        }
        return await completion as Result;
      })(),
      awaitSuspend: (until) => profile.awaitSuspend(until, ctx),
    };

    const note_id = resolveNoteId(note);
    const emit = onStep
      ? async (draft: PerformanceStepDraft) => {
        const step = {
          ...draft,
          note_id,
          execution_id,
          step_index: stepCount++
        };
        await (relay ?? onStep)?.(step);
      }
      : async (draft: PerformanceStepDraft) => {
        if (!relay) return;
        await relay({
          ...draft,
          note_id,
          execution_id,
          step_index: stepCount++,
        });
      };

    const definition = registry.definitions.get(note.type);

    try {
      if (cancelToken.cancelled()) {
        throw new Cancelled(cancelToken.reason ?? "user");
      }
      await emit({ phase: "enter", });
      await emit({ phase: "active", payload: { reason: "entered" }, });
      fsm.onEnter();
      fsm.onActive();

      if (definition) {
        const final = await runFxExecution(
          definition.execute(ctx as never),
          async (step) => emit({
            phase: step.phase,
            payload: step.payload,
            effect: step.effect,
            timestamp: step.timestamp,
          }),
          cancelToken,
        );
        fsm.onExit();
        await emit({
          phase: "exit",
          effect: resolveExitEffect(note, ctx, final),
        });
        if (note.id) config.idSlots["#" + note.id] = final;
        return final;
      }

      throw new Error(`No NoteDefinition for ${note.type}`);

    } catch (e) {
      // Cancelを正規化する
      let reason: string, err: Error;
      if(e instanceof Cancelled) {
        reason  = e.reason;
        err = e;
      } else if(isCancelledError(e)) {
        reason = cancelledReasonFromError(e);
        err = new Cancelled(reason);
      } else {
        throw e;
      }
      
      fsm.onCancel();
      await emit({ phase: "cancel", payload: { reason }, });
      throw err;
    }
  };

  const done = new Promise((resolve,reject)=>{
    queueMicrotask(() => {
      (async () => {
        let finalValue: unknown = undefined;
        try {
          finalValue = await run(rootNote, appContext, rootCancelToken);
        } catch (e) {
          reject(e);
          return;
        }
        resolve(finalValue);
      })()
        .catch(reject)
        .finally(unbind_exec_id);
    });
  });

  return {
    cancel: () => rootCancelToken.cancel("user"),
    done,
  };
}


type Phase = "entered" | "active" | "suspended" | "exited" | "cancelled";

class RunnerFSM {
  private phase: Phase = "entered";

  onEnter() {
    if (this.phase !== "entered") throw new Error("FSM violation: enter twice");
  }

  onActive() {
    if (this.phase !== "entered" && this.phase !== "suspended") {
      throw new Error(`FSM violation: active from ${this.phase}`);
    }
    this.phase = "active";
  }

  onResume() {
    if (this.phase !== "suspended") throw new Error("FSM violation: resume without suspend");
  }

  onExit() {
    if (this.phase !== "active" && this.phase !== "suspended") {
      throw new Error(`FSM violation: exit from ${this.phase}`);
    }
    this.phase = "exited";
  }

  onCancel() {
    if (this.phase === "exited" || this.phase === "cancelled") {
      throw new Error("FSM violation: cancel after end");
    }
    this.phase = "cancelled";
  }
}

// Re-exported for backward compatibility with existing importers
// (e.g. modules that previously imported flatten/resolveNoteId from here).
export { flattenFxNotes, resolveNoteId };

