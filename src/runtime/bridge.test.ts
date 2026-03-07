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
});
