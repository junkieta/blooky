import type {
  AppContext,
  FxConditionNote,
  ExecutionContext,
  FxCallAction,
  FxCallNote,
  FxExecution,
  FxFlowNote,
  FxLoopNote,
  FxNoneNote,
  FxParallelNote,
  FxRaceNote,
  FxReturnNote,
  FxSequenceNote,
  FxSwitchNote,
  FxWaitNote,
  FxYieldNote,
  NoteDefinition,
  PerformanceStep,
} from "../blooky-fx-types";
import { bind } from "../blooky-context";
import { createChildCancelToken } from "./cancel-token";

const step = (
  ctx: ExecutionContext,
  phase: PerformanceStep["phase"],
  payload: unknown,
  stepIndex = 0,
): PerformanceStep => ({
  phase,
  note_id: ctx.note.id ?? ctx.note.type,
  execution_id: ctx.executionId,
  step_index: stepIndex,
  payload,
});

const resolveAction = (
  note: FxCallNote,
  ctx: ExecutionContext,
): FxCallAction => ctx.resolve(note.action)() as FxCallAction;

export class CallNoteDefinition implements NoteDefinition<"call", unknown> {
  readonly type = "call" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxCallNote },
  ): FxExecution<unknown> {
    const action = resolveAction(ctx.note, ctx);
    const input = ctx.note.input === undefined ? undefined : ctx.resolve(ctx.note.input)();

    yield step(ctx, "active", { event: "prepare" }, 0);
    yield step(ctx, "active", {
      event: "executing",
      functionName: action.call.name || "anonymous",
      input,
    }, 1);

    if (ctx.cancelToken.cancelled()) {
      throw new Error(`cancelled:${ctx.cancelToken.reason ?? "user"}`);
    }

    const result = await action.call(ctx.appContext, input);
    yield step(ctx, "active", { event: "completed", result }, 2);
    return result;
  }
}

export const callNoteDefinition = new CallNoteDefinition();

export class WaitNoteDefinition implements NoteDefinition<"wait", unknown> {
  readonly type = "wait" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxWaitNote },
  ): FxExecution<unknown> {
    const until = ctx.note.timer !== undefined
      ? { kind: "timer" as const, timer: ctx.note.timer }
      : { kind: "ref" as const, ref: ctx.note.until! };

    yield step(ctx, "suspend", { until });
    const result = await ctx.awaitSuspend(until);
    if (result.kind !== "continue") return result;
    yield step(ctx, "resume", { until });
    return undefined;
  }
}

export class SequenceNoteDefinition implements NoteDefinition<"sequence", unknown> {
  readonly type = "sequence" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxSequenceNote },
  ): FxExecution<unknown> {
    let result: unknown;
    for (const child of ctx.note.steps) {
      result = yield* ctx.executeChild(child);
    }
    return result;
  }
}

export const waitNoteDefinition = new WaitNoteDefinition();
export const sequenceNoteDefinition = new SequenceNoteDefinition();

export class NoneNoteDefinition implements NoteDefinition<"none", undefined> {
  readonly type = "none" as const;

  async *execute(
    _ctx: ExecutionContext & { note: FxNoneNote },
  ): FxExecution<undefined> {
    return undefined;
  }
}

export class ReturnNoteDefinition implements NoteDefinition<"return", unknown> {
  readonly type = "return" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxReturnNote },
  ): FxExecution<unknown> {
    return ctx.note.value === undefined ? undefined : ctx.resolve(ctx.note.value)();
  }
}

export class ConditionNoteDefinition implements NoteDefinition<"condition", unknown> {
  readonly type = "condition" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxConditionNote },
  ): FxExecution<unknown> {
    const selected = ctx.resolve(ctx.note.if)() ? ctx.note.then : ctx.note.else;
    return selected === undefined ? undefined : yield* ctx.executeChild(selected);
  }
}

export class SwitchNoteDefinition implements NoteDefinition<"switch", unknown> {
  readonly type = "switch" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxSwitchNote },
  ): FxExecution<unknown> {
    const key = ctx.resolve(ctx.note.by)();
    const selected = ctx.note.cases.get(key) ?? ctx.note.default;
    return selected === undefined ? undefined : yield* ctx.executeChild(selected);
  }
}

export class LoopNoteDefinition implements NoteDefinition<"loop", unknown> {
  readonly type = "loop" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxLoopNote },
  ): FxExecution<unknown> {
    const startedAt = Date.now();
    let iteration = 0;
    let result: unknown;
    while (ctx.resolve(ctx.note.cond)()) {
      if (ctx.cancelToken.cancelled()) {
        throw new Error(`cancelled:${ctx.cancelToken.reason ?? "user"}`);
      }
      if (ctx.note.maxIterations !== undefined && iteration >= ctx.note.maxIterations) break;
      if (ctx.note.maxDuration !== undefined && Date.now() - startedAt >= ctx.note.maxDuration) break;
      result = yield* ctx.executeChild(ctx.note.body);
      iteration += 1;
    }
    return result;
  }
}

const overlayContext = (parent: AppContext, patch: AppContext): AppContext => {
  const scoped = Object.create(parent) as AppContext;
  for (const key of Object.keys(patch)) {
    bind(scoped, key, patch[key]);
    Object.defineProperty(scoped, key, {
      value: patch[key],
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return scoped;
};

export class FlowNoteDefinition implements NoteDefinition<"flow", unknown> {
  readonly type = "flow" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxFlowNote },
  ): FxExecution<unknown> {
    return yield* ctx.executeChild(ctx.note.child, overlayContext(ctx.appContext, ctx.note.context));
  }
}

export const noneNoteDefinition = new NoneNoteDefinition();
export const returnNoteDefinition = new ReturnNoteDefinition();
export const conditionNoteDefinition = new ConditionNoteDefinition();
export const switchNoteDefinition = new SwitchNoteDefinition();
export const loopNoteDefinition = new LoopNoteDefinition();
export const flowNoteDefinition = new FlowNoteDefinition();

type ConcurrentState = {
  index: number;
  state: IteratorResult<PerformanceStep, unknown>;
};

const relayConcurrent = async function* (
  executions: FxExecution<unknown>[],
): FxExecution<unknown[]> {
  const pending = new Map<number, Promise<ConcurrentState>>(
    executions.map((execution, index) => [
      index,
      execution.next().then((state) => ({ index, state } as ConcurrentState)),
    ]),
  );
  const results: unknown[] = new Array(executions.length);

  while (pending.size > 0) {
    const current = await Promise.race([...pending.values()]);
    if (current.state.done) {
      results[current.index] = current.state.value;
      pending.delete(current.index);
    } else {
      pending.set(current.index, executions[current.index]
        .next()
        .then((state) => ({ index: current.index, state } as ConcurrentState)));
      yield current.state.value as PerformanceStep;
    }
  }
  return results;
};

export class ParallelNoteDefinition implements NoteDefinition<"parallel", unknown[]> {
  readonly type = "parallel" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxParallelNote },
  ): FxExecution<unknown[]> {
    return yield* relayConcurrent(ctx.note.steps.map((child) => ctx.executeChild(child)));
  }
}

export class RaceNoteDefinition implements NoteDefinition<"race", unknown> {
  readonly type = "race" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxRaceNote },
  ): FxExecution<unknown> {
    const tokens = ctx.note.steps.map(() => createChildCancelToken(ctx.cancelToken));
    const executions = ctx.note.steps.map((child, index) =>
      ctx.executeChild(child, ctx.appContext, tokens[index]),
    );
    const pending = new Map<number, Promise<ConcurrentState>>(
      executions.map((execution, index) => [
        index,
        execution.next().then((state) => ({ index, state } as ConcurrentState)),
      ]),
    );

    while (pending.size > 0) {
      const current = await Promise.race([...pending.values()]);
      if (current.state.done) {
        tokens.forEach((token, index) => {
          if (index !== current.index) token.cancel("race_loser");
        });
        return current.state.value;
      }
      pending.set(current.index, executions[current.index]
        .next()
        .then((state) => ({ index: current.index, state } as ConcurrentState)));
      yield current.state.value as PerformanceStep;
    }
    return undefined;
  }
}

export class YieldNoteDefinition implements NoteDefinition<"yield", unknown> {
  readonly type = "yield" as const;

  async *execute(
    ctx: ExecutionContext & { note: FxYieldNote },
  ): FxExecution<unknown> {
    const until = {
      kind: "yield" as const,
      target: { kind: "local" as const, ref: ctx.note.score },
      input: ctx.note.input,
      meta: { noteType: "yield" },
    };
    yield step(ctx, "suspend", { until });
    const result = await ctx.awaitSuspend(until);
    if (result.kind === "value") return result.value;
    return result;
  }
}

export const parallelNoteDefinition = new ParallelNoteDefinition();
export const raceNoteDefinition = new RaceNoteDefinition();
export const yieldNoteDefinition = new YieldNoteDefinition();
