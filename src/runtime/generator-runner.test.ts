import type {
  ExecutionContext,
  FxCallNote,
  FxParallelNote,
  FxRaceNote,
  FxSequenceNote,
  FxWaitNote,
  PerformanceStep,
} from "../blooky-fx-types";
import { createChildCancelToken } from "./cancel-token";
import { prepare, execute } from "./engine";
import {
  callNoteDefinition,
  parallelNoteDefinition,
  raceNoteDefinition,
  sequenceNoteDefinition,
  waitNoteDefinition,
} from "./note-definitions";
import { runFxExecution } from "./generator-runner";
import { createRegistry, registerDefault } from "./registry";

const createContext = <T extends ExecutionContext["note"]>(
  note: T,
  executeChild: ExecutionContext["executeChild"] = (() => {
    throw new Error("not used");
  }) as ExecutionContext["executeChild"],
  awaitSuspend: ExecutionContext["awaitSuspend"] = async () => ({ kind: "continue" }),
) => ({
  note,
  appContext: {},
  executionId: "execution-1",
  cancelToken: createChildCancelToken(),
  config: {} as ExecutionContext["config"],
  resolve: <V>(ref: V) => () => ref,
  executeChild,
  awaitSuspend,
}) as ExecutionContext & { note: T };

describe("Note async generator execution", () => {
  it("relays call steps and returns the generator result", async () => {
    const note: FxCallNote = {
      type: "call",
      action: {
        call: async (_context, input) => `result:${input}`,
      },
      input: "value",
      id: "call-1",
    };
    const ctx = createContext(note);
    const cancelToken = ctx.cancelToken;
    const steps: string[] = [];

    const result = await runFxExecution(
      callNoteDefinition.execute(ctx),
      (step) => {
        steps.push((step.payload as { event: string }).event);
      },
      cancelToken,
    );

    expect(result).toBe("result:value");
    expect(steps).toEqual(["prepare", "executing", "completed"]);
  });

  it("waits through the context suspend service", async () => {
    const note: FxWaitNote = { type: "wait", timer: 0 };
    const untils: unknown[] = [];
    const ctx = createContext(note, undefined, async (until) => {
      untils.push(until);
      return { kind: "continue" };
    });
    const steps: PerformanceStep[] = [];

    const result = await runFxExecution(waitNoteDefinition.execute(ctx), (step) => {
      steps.push(step);
    }, ctx.cancelToken);

    expect(result).toBeUndefined();
    expect(untils).toEqual([{ kind: "timer", timer: 0 }]);
    expect(steps.map((step) => step.phase)).toEqual(["suspend", "resume"]);
  });

  it("relays child steps and propagates the last child result", async () => {
    const child: FxCallNote = {
      type: "call",
      action: { call: async () => "child-result" },
    };
    const note: FxSequenceNote = { type: "sequence", steps: [child] };
    const childExecution = callNoteDefinition.execute(createContext(child));
    const ctx = createContext(note, (() => childExecution) as ExecutionContext["executeChild"]);
    const events: unknown[] = [];

    const result = await runFxExecution(sequenceNoteDefinition.execute(ctx), (step) => {
      events.push((step.payload as { event: string }).event);
    }, ctx.cancelToken);

    expect(result).toBe("child-result");
    expect(events).toEqual(["prepare", "executing", "completed"]);
  });

  it("runs a sequence through the production generator path", async () => {
    const registry = createRegistry();
    registerDefault(registry);
    const note: FxSequenceNote = {
      type: "sequence",
      steps: [{
        type: "call",
        action: { call: async () => "production-result" },
      }],
    };
    const observed: PerformanceStep[] = [];
    const result = await execute({
      prepared: prepare(note),
      registry,
      profile: {
        resolveSelection: () => null,
        awaitSuspend: async () => ({ kind: "continue" }),
        projectEffect: (value) => value,
        applyEffect: async () => ({ kind: "none" }),
      },
      onStep: (step) => {
        observed.push(step);
      },
    }).done;

    expect(result).toBe("production-result");
    expect(observed
      .map((step) => (step.payload as { event?: string })?.event)
      .filter((event): event is string => event !== undefined))
      .toEqual(["prepare", "executing", "completed"]);
  });

  it("orchestrates parallel child generators locally", async () => {
    const children: FxCallNote[] = [
      { type: "call", action: { call: async () => "left" } },
      { type: "call", action: { call: async () => "right" } },
    ];
    const note: FxParallelNote = { type: "parallel", steps: children };
    const ctx = createContext(note, ((child) => {
      return callNoteDefinition.execute(createContext(child as FxCallNote));
    }) as ExecutionContext["executeChild"]);

    const result = await runFxExecution(parallelNoteDefinition.execute(ctx), undefined, ctx.cancelToken);

    expect(result).toEqual(["left", "right"]);
  });

  it("returns the first race result and cancels the other child", async () => {
    const winner: FxCallNote = { type: "call", action: { call: async () => "winner" } };
    const loser: FxCallNote = { type: "call", action: { call: async () => "loser" } };
    const note: FxRaceNote = { type: "race", steps: [winner, loser] };
    const tokens: unknown[] = [];
    const ctx = createContext(note, ((child, _appContext, token) => {
      if (child === loser) tokens.push(token);
      return callNoteDefinition.execute(createContext(child as FxCallNote));
    }) as ExecutionContext["executeChild"]);

    const result = await runFxExecution(raceNoteDefinition.execute(ctx), undefined, ctx.cancelToken);

    expect(result).toBe("winner");
    expect(tokens).toHaveLength(1);
    expect((tokens[0] as ReturnType<typeof createChildCancelToken>).cancelled()).toBe(true);
  });
});
