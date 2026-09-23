import type { ExecutionContext, FxCallNote } from "../blooky-fx-types";
import { createChildCancelToken } from "./cancel-token";
import { callNoteDefinition } from "./note-definitions";
import { runFxExecution } from "./generator-runner";

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
    const cancelToken = createChildCancelToken();
    const ctx = {
      note,
      appContext: {},
      executionId: "execution-1",
      cancelToken,
      config: {} as ExecutionContext["config"],
      resolve: <T>(ref: T) => () => ref,
      executeChild: (() => {
        throw new Error("not used");
      }) as ExecutionContext["executeChild"],
    } as ExecutionContext & { note: FxCallNote };
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
});
