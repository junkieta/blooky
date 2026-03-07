import { execute, prepare } from "./engine";
import type {
  FxNote,
  PerformanceStep,
  Registry,
  RunnerProfile,
  SemanticEvent,
} from "../blooky-fx-types";

const makeRegistry = (events: SemanticEvent[]): Registry => ({
  semantics: new Map([
    [
      "none",
      function* (): Generator<SemanticEvent, void, void> {
        for (const ev of events) yield ev;
      },
    ],
  ]),
  structures: new Map(),
});

const makeProfile = (
  opts?: {
    applyEffectResult?: unknown;
  }
): RunnerProfile => ({
  resolveSelection: () => null,
  awaitSuspend: async () => ({ kind: "continue" }),
  projectEffect: (ref) => ({ projected: ref }),
  applyEffect: async () => {
    if (opts?.applyEffectResult === undefined) return { kind: "none" };
    return { kind: "value", value: opts.applyEffectResult };
  },
  applyExitBoundary: async () => {},
});

const collectSteps = async (
  note: FxNote,
  registry: Registry,
  profile: RunnerProfile
) => {
  const prepared = prepare(note, {});
  const handle = execute({ prepared, registry, profile });
  const steps: PerformanceStep[] = [];
  handle.observeStep((s) => {
    steps.push(s);
  });
  await handle.done;
  return steps;
};

describe("runtime engine phase/event contract", () => {
  test("result semantic event is emitted as active + payload.event", async () => {
    const steps = await collectSteps(
      { type: "none", id: "n1" },
      makeRegistry([{ type: "result", value: 42 }]),
      makeProfile()
    );

    expect(steps.map((s) => s.phase)).toEqual(["enter", "active", "active", "exit"]);
    expect(steps.some((s) => s.phase === "suspend")).toBe(false);
    expect(steps.some((s) => (s.payload as any)?.event === "result")).toBe(true);
    expect(steps.some((s) => (s.payload as any)?.event === "effect")).toBe(false);
    expect(steps.some((s) => (s.payload as any)?.event === "terminate")).toBe(false);
    expect(steps.every((s) => s.step_index >= 0)).toBe(true);
  });

  test("suspend emits resume followed by active", async () => {
    const steps = await collectSteps(
      { type: "none", id: "n2" },
      makeRegistry([
        { type: "suspend", until: { kind: "timer", timer: 0 } as any },
        { type: "result", value: "ok" },
      ]),
      makeProfile()
    );

    expect(steps.map((s) => s.phase)).toEqual([
      "enter",
      "active",
      "suspend",
      "resume",
      "active",
      "active",
      "exit",
    ]);
    const resumedAt = steps.findIndex((s) => s.phase === "resume");
    expect(steps[resumedAt + 1].phase).toBe("active");
  });

  test("effect and terminate semantic events are represented via payload.event", async () => {
    const steps = await collectSteps(
      { type: "none", id: "n3" },
      makeRegistry([
        { type: "effect", ref: { kind: "call", action: () => ({ call: () => 1 }) } },
        { type: "terminate", value: 7 },
      ]),
      makeProfile()
    );

    expect(steps.map((s) => s.phase)).toEqual([
      "enter",
      "active",
      "active",
      "active",
      "exit",
    ]);
    expect(steps.some((s) => (s.payload as any)?.event === "effect")).toBe(true);
    expect(steps.some((s) => (s.payload as any)?.event === "result")).toBe(false);
    expect(steps.some((s) => (s.payload as any)?.event === "terminate")).toBe(true);
    expect((steps.at(-1)?.payload as any)?.terminated).toBe(true);
  });
});

describe("wait validation contract", () => {
  test("prepare rejects wait note when both timer and until are set", () => {
    expect(() =>
      prepare({
        type: "wait",
        timer: 100 as any,
        until: (() => true) as any,
      })
    ).toThrow("fx-wait requires exactly one of 'timer' or 'until'");
  });

  test("prepare rejects wait note when neither timer nor until is set", () => {
    expect(() =>
      prepare({
        type: "wait",
      } as any)
    ).toThrow("fx-wait requires exactly one of 'timer' or 'until'");
  });
});

describe("score validation contract", () => {
  test("prepare rejects call note without action", () => {
    expect(() =>
      prepare({
        type: "call",
      } as any)
    ).toThrow("call.action is required");
  });

  test("prepare rejects condition note without then", () => {
    expect(() =>
      prepare({
        type: "condition",
        if: true,
      } as any)
    ).toThrow("condition.then is required");
  });

  test("prepare rejects switch note when cases is not a Map", () => {
    expect(() =>
      prepare({
        type: "switch",
        by: "k",
        cases: {} as any,
      } as any)
    ).toThrow("switch.cases must be a Map");
  });
});

describe("authoritative step sink contract", () => {
  test("exit step carries done effect for bridge extraction", async () => {
    const dripper = { kind: "dripper" } as any;
    const prepared = prepare(
      {
        type: "none",
        id: "n4",
        done: () => dripper,
      } as any,
      {}
    );

    const seen: PerformanceStep[] = [];
    const handle = execute({
      prepared,
      registry: makeRegistry([{ type: "result", value: 42 }]),
      profile: makeProfile(),
      authoritativeStepSink: async (step) => {
        // Simulate bridge-side async handling.
        if (step.effect) await Promise.resolve();
        seen.push(step);
      },
    });

    await handle.done;
    const exit = seen.find((s) => s.phase === "exit");
    expect(exit).toBeTruthy();
    expect((exit!.effect as any)?.kind).toBe("done");
    expect((exit!.effect as any)?.dripper).toBe(dripper);
    expect((exit!.effect as any)?.value).toBe(42);
  });
});
