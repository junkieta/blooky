import type {
  ExecutionContext,
  FxCallAction,
  FxCallNote,
  FxExecution,
  NoteDefinition,
  PerformanceStep,
} from "../blooky-fx-types";

const step = (
  ctx: ExecutionContext,
  phase: PerformanceStep["phase"],
  payload: unknown,
  stepIndex: number,
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
