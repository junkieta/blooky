import { createDefaultBridge } from "./bridge";
import type { PerformanceStep } from "../blooky-fx-types";

const step = (overrides?: Partial<PerformanceStep>): PerformanceStep => ({
  phase: "active",
  note_id: "n1",
  execution_id: "exec:n0",
  step_index: 0,
  timestamp: Date.now(),
  ...overrides,
});

describe("runtime bridge", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test("frame observers are isolated from each other", async () => {
    const submitPlan = jest.fn(async () => {});
    const bridge = createDefaultBridge({ runtime: { submitPlan } });

    const called: string[] = [];
    bridge.observeFrame(() => {
      called.push("a");
      throw new Error("observer boom");
    });
    bridge.observeFrame(() => {
      called.push("b");
    });

    await bridge.onStep(step());
    expect(called).toEqual(["a", "b"]);
    expect(submitPlan).toHaveBeenCalledTimes(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test("done effect is submitted as plan", async () => {
    const submitPlan = jest.fn(async () => {});
    const bridge = createDefaultBridge({ runtime: { submitPlan } });
    const dripper = { kind: "dripper" };

    await bridge.onStep(
      step({
        phase: "exit",
        effect: { kind: "done", dripper, value: 42 } as any,
      })
    );

    expect(submitPlan).toHaveBeenCalledTimes(1);
    expect(submitPlan).toHaveBeenCalledWith({ dripper, value: 42 });
  });

  test("frame observer receives plan batch for done effect", async () => {
    const submitPlan = jest.fn(async () => {});
    const bridge = createDefaultBridge({ runtime: { submitPlan } });
    const dripper = { kind: "dripper" };
    const frames: any[] = [];

    bridge.observeFrame((frame) => {
      frames.push(frame);
    });

    await bridge.onStep(
      step({
        phase: "exit",
        effect: { kind: "done", dripper, value: 1 } as any,
      })
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].step.phase).toBe("exit");
    expect(frames[0].plans).toEqual([{ dripper, value: 1 }]);
  });
});
