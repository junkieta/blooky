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
  SemanticEvent,
  StepSink,
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

// ExecutionConfig.idSlots の生成
const createIdSlots = (flow: FxNote, parentSlot?: Record<string, any>) => {
  // id - final value の slot
  const idSlots: Record<string, any> = {};
  // 親slotsからの指定があれば引き継ぐ(yield.inputは$_)
  if(parentSlot) {
    Object.assign(idSlots, parentSlot);
  }
  flatten(flow).forEach((n) => {
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

const createExecutionIdGenerator = function * (seed?: string) {
  const executionSeed = typeof seed === "string"
    ? seed
    : `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let executionSeq = 0;
  while(true) {
    yield `${executionSeed}:${executionSeq++}`;
  }
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

const validateWaitNote = (
  note: Extract<FxNote, { type: "wait" }>,
  path: string
) => {
  const hasTimer = note.timer !== undefined;
  const hasUntil = note.until !== undefined;
  if (hasTimer === hasUntil) {
    failValidation("fx-wait requires exactly one of 'timer' or 'until'", path, note);
  }
};

const validateScore = (flow: FxNote) => {
  const walk = (note: unknown, path: string): void => {
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
        typed.steps.forEach((child: unknown, i: number) => walk(child, `${path}.steps[${i}]`));
        return;
      case "wait":
        validateWaitNote(typed, path);
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
        walk(typed.body, `${path}.body`);
        return;
      case "condition":
        if (typed.if === undefined) {
          failValidation("condition.if is required", path, note);
        }
        if (typed.then === undefined) {
          failValidation("condition.then is required", path, note);
        }
        walk(typed.then, `${path}.then`);
        if (typed.else !== undefined) walk(typed.else, `${path}.else`);
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
          walk(child, `${path}.cases[${String(key)}]`);
          caseIndex += 1;
        }
        if (typed.default !== undefined) walk(typed.default, `${path}.default`);
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
      case "context":
        if (!typed.context || typeof typed.context !== "object" || Array.isArray(typed.context)) {
          failValidation("context.context must be an object", path, note);
        }
        if (typed.child === undefined) {
          failValidation("context.child is required", path, note);
        }
        walk(typed.child, `${path}.child`);
        return;
      case "return":
        return;
      default:
        failValidation(`Unsupported FxNote.type: ${String(typed.type)}`, path, note);
    }
  };

  walk(flow, "root");
};

export function prepare(flow: FxNote, initialAppContext: AppContext = {}, parent?: Partial<ExecutionConfig>): PreparedFx {
  validateScore(flow);
  return {
    rootNote: flow,
    appContext: createAppContext(initialAppContext),
    config: {
      resolver: parent?.resolver ?? defaultResolve,
      cancelToken: createCancelToken(parent?.cancelToken),
      idSlots: createIdSlots(flow, parent?.idSlots),
      executionId: parent?.executionId ?? `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  };
}

export function execute(args: {
  prepared: PreparedFx;
  registry: Registry;
  profile: RunnerProfile;
  onStep?: (step: PerformanceStep) => void | Promise<void>;
}): ExecutionHandle {
  const { prepared, registry, profile, onStep } = args;
  const { rootNote, config, appContext } = prepared;

  const nextExecutionId = createExecutionIdGenerator(config.executionId);
  const notifyStep = onStep ? createStepEmitter(onStep) : ()=>{};
  const resolveExitEffect = (note: FxNote, ctx: ExecutionContext, result: unknown) => {
    const done = (note as any).done;
    if (done === undefined) return undefined;
    const dripper = ctx.config.resolver(done as FxRef<unknown>, ctx)();
    const value = ctx.config.resolver(result as FxRef<unknown>, ctx)();
    return { kind: "done", dripper, value };
  };

  const run = async (
    note: FxNote,
    appContext: Record<string, any>,
    cancelToken: CancelToken
  ): Promise<unknown> => {
    
    const execution_id = nextExecutionId.next().value;

    const ctx: ExecutionContext = {
      note,
      config,
      appContext,
      executionId: execution_id,
    };

    const fsm = new RunnerFSM();
    await notifyStep({
      phase: "enter",
      note_id: resolveNoteId(note),
      execution_id,
    });
    await notifyStep({
      phase: "active",
      note_id: resolveNoteId(note),
      execution_id,
      payload: { reason: "entered" },
    });
    fsm.onEnter();
    fsm.onActive();

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
              overrideAppContext ?? ctx.appContext,
              overrideCancelToken ?? cancelToken
            ),
          profile,
          cancelToken,
        });

        fsm.onExit();
        await notifyStep({
          phase: "exit",
          note_id: resolveNoteId(note),
          execution_id,
          payload: { result: value },
          effect: resolveExitEffect(note, ctx, value),
        });
        if(note.id) config.idSlots["#"+note.id] = value;
        return value;
      }

      const sem = registry.semantics.get(note.type);
      if (!sem) throw new Error(`No semantics for ${note.type}`);

      let final: unknown = undefined;
      for (const ev of sem(note, ctx)) {
        fsm.onEvent(ev);
        const r = await dispatchSemEvent(ev, { profile, ctx, cancelToken, emit: notifyStep, });
        if (ev.type === "suspend") {
          fsm.onResume();
          fsm.onActive();
        }
        if (r.kind === "result") {
          if (ev.type !== "result") {
            fsm.onEvent({ type: "result", value: r.value });
          }
          final = r.value;
        }
      }

      fsm.onExit();
      await notifyStep({
        phase: "exit",
        note_id: resolveNoteId(note),
        execution_id,
        payload: { result: final },
        effect: resolveExitEffect(note, ctx, final),
      });
      if (note.id) config.idSlots["#" + note.id] = final;
      return final;

    } catch (e) {
      if (e instanceof Terminated) {
        fsm.onExit();
        await notifyStep({
          phase: "exit",
          note_id: resolveNoteId(note),
          execution_id,
          payload: { result: e.value, terminated: true },
          effect: resolveExitEffect(note, ctx, e.value),
        });
        if(note.id) config.idSlots["#"+note.id] = e.value;
        throw e;
      }

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
      await notifyStep({
        phase: "cancel",
        note_id: resolveNoteId(note),
        execution_id,
        payload: { reason },
      });
      throw err;
    }
  };

  const done = new Promise((resolve,reject)=>{
    queueMicrotask(() => {
      (async () => {
        let finalValue: unknown = undefined;

        try {
          finalValue = await run(rootNote, appContext, config.cancelToken);
        } catch (e) {
          if (e instanceof Terminated) {
            finalValue = e.value;
          } else {
            reject(e);
            return;
          }
        }

        // gcされるため余計な処理ではある
        if (rootNote.id) config.idSlots["#" + rootNote.id] = finalValue;
        resolve(finalValue);
      })().catch(reject);
    });
  });

  return {
    cancel: () => config.cancelToken.cancel("user"),
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
  ctx: ExecutionContext;
  cancelToken: CancelToken;
  emit: StepSink;
};

const dispatchSemEvent = async (ev: SemanticEvent, deps: DispatchDeps) => {
  if (deps.cancelToken.cancelled()) throw new Cancelled(deps.cancelToken.reason ?? "user");

  switch (ev.type) {

    case "effect": {
      const projected = deps.profile.projectEffect(ev.ref, deps.ctx);
      await deps.emit({
        phase: "active",
        note_id: resolveNoteId(deps.ctx.note),
        execution_id: deps.ctx.executionId,
        payload: { event: "effect", effect: projected },
        effect: projected,
      });

      const value = await deps.profile.applyEffect(ev.ref, deps.ctx);
      if (value.kind === "none") return { kind: "continue" as const };
      await deps.emit({
        phase: "active",
        note_id: resolveNoteId(deps.ctx.note),
        execution_id: deps.ctx.executionId,
        payload: { event: "result", value },
      });
      return { kind: "result" as const, value };
    }

    case "suspend": {
      await deps.emit({
        phase: "suspend",
        note_id: resolveNoteId(deps.ctx.note),
        execution_id: deps.ctx.executionId,
        payload: { until: ev.until },
      });

      const out = await deps.profile.awaitSuspend(ev.until, deps.ctx, deps.cancelToken);
      await deps.emit({
        phase: "resume",
        note_id: resolveNoteId(deps.ctx.note),
        execution_id: deps.ctx.executionId,
        payload: { until: ev.until },
      });
      await deps.emit({
        phase: "active",
        note_id: resolveNoteId(deps.ctx.note),
        execution_id: deps.ctx.executionId,
        payload: { reason: "resumed" },
      });

      if (out.kind === "continue") return out;

      await deps.emit({
        phase: "active",
        note_id: resolveNoteId(deps.ctx.note),
        execution_id: deps.ctx.executionId,
        payload: { event: "result", value: out },
      });
      return { kind: "result" as const, value: out };
    }

    case "result":
      {
        const value = deps.ctx.config.resolver(ev.value as FxRef<unknown>, deps.ctx)();
        await deps.emit({
          phase: "active",
          note_id: resolveNoteId(deps.ctx.note),
          execution_id: deps.ctx.executionId,
          payload: { event: "result", value },
        });
        return { kind: "result" as const, value };
      }

    case "terminate":
      {
        const value = deps.ctx.config.resolver(ev.value as FxRef<unknown>, deps.ctx)();
        await deps.emit({
          phase: "active",
          note_id: resolveNoteId(deps.ctx.note),
          execution_id: deps.ctx.executionId,
          payload: { event: "terminate", value },
        });
        throw new Terminated(value);
      }
  }
};

const createStepEmitter = (onStep: (step: PerformanceStep) => void | Promise<void>) => {
  const index = new Map<string, number>();
  return async (step: PerformanceStepDraft) => {
    const stepIndex = step.step_index ?? ((index.get(step.execution_id) ?? -1) + 1);
    index.set(step.execution_id, stepIndex);
    await onStep({
      ...step,
      step_index: stepIndex,
      timestamp: step.timestamp ?? Date.now(),
    });
  };
}

const NOTE_ID_SYMBOL = Symbol.for("blooky.note_id");
let autoNoteIdCounter = 0;

const resolveNoteId = (note: FxNote): string => {
  if (note.id && note.id.length) return note.id;
  const existing = (note as any)[NOTE_ID_SYMBOL];
  if (typeof existing === "string" && existing.length) return existing;
  const generated = `note-${autoNoteIdCounter++}`;
  (note as any)[NOTE_ID_SYMBOL] = generated;
  return generated;
};


type Phase = "entered" | "active" | "suspended" | "exited" | "cancelled";

class RunnerFSM {
  private phase: Phase = "entered";
  private sawResult = false;
  private sawTerminate = false;

  onEnter() {
    if (this.phase !== "entered") throw new Error("FSM violation: enter twice");
  }

  onActive() {
    if (this.phase !== "entered" && this.phase !== "suspended") {
      throw new Error(`FSM violation: active from ${this.phase}`);
    }
    this.phase = "active";
  }

  onEvent(ev: SemanticEvent) {
    if (this.phase === "exited" || this.phase === "cancelled") {
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
        if (this.phase !== "active") {
          throw new Error("FSM violation: suspend when not active");
        }
        this.phase = "suspended";
        return;

      case "result":
        if (this.sawTerminate) throw new Error("FSM violation: result with terminate");
        if (this.sawResult) throw new Error("FSM violation: duplicate result");
        this.sawResult = true;
        return;

      case "terminate":
        if (this.sawResult) throw new Error("FSM violation: terminate with result");
        if (this.sawTerminate) throw new Error("FSM violation: duplicate terminate");
        this.sawTerminate = true;
        return;
    }
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

