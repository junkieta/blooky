import type { CancelToken, FxCallNote, PerformanceStep, YieldRequest } from "../blooky-fx-types";
import { Cancelled, createChildCancelToken } from "./cancel-token";
import { RemoteYieldDriver } from "./yield";
import { runFxExecution } from "./generator-runner";
import { prepare, execute } from "./engine";
import { createRegistry, registerDefault } from "./registry";

const createToken = () => createChildCancelToken();

describe("execution cancellation propagation", () => {
  it("propagates parent cancellation to a delegated child token", () => {
    const parent = createToken();
    const child = createChildCancelToken(parent);
    const reasons: string[] = [];
    child.onCancel((reason) => reasons.push(reason));

    parent.cancel("user");

    expect(child.cancelled()).toBe(true);
    expect(child.reason).toBe("user");
    expect(reasons).toEqual(["user"]);
  });

  it("abandons a suspended generator instead of returning cancellation as Result", async () => {
    const token = createToken();
    const execution = (async function* () {
      yield {} as PerformanceStep;
      await new Promise<void>((resolve) => {
        token.onCancel(() => resolve());
      });
      return "must-not-complete";
    })();

    const running = runFxExecution(execution, undefined, token);
    token.cancel("user");

    await expect(running).rejects.toThrow("Execution cancelled: user");
  });

  it("does not relay a step produced after cancellation", async () => {
    const token = createToken();
    const release = Promise.resolve();
    const observed: PerformanceStep[] = [];
    const execution = (async function* () {
      await release;
      yield { phase: "active" } as PerformanceStep;
      return "must-not-complete";
    })();

    token.cancel("user");
    await expect(runFxExecution(execution, (step) => {
      observed.push(step);
    }, token)).rejects.toThrow("Execution cancelled: user");
    expect(observed).toEqual([]);
  });

  it("emits cancel without exit, resume, or effect", async () => {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const pendingAction = new Promise<string>((resolve) => { release = () => resolve("done"); });
    const note: FxCallNote = {
      type: "call",
      action: {
        call: async () => {
          started();
          return pendingAction;
        },
      },
    };
    const registry = createRegistry();
    registerDefault(registry);
    const steps: PerformanceStep[] = [];
    const handle = execute({
      prepared: prepare(note),
      registry,
      profile: { awaitSuspend: async () => ({ kind: "continue" }) },
      onStep: (step) => { steps.push(step); },
    });

    await startedPromise;
    handle.cancel();
    release();
    await expect(handle.done).rejects.toThrow("Execution cancelled: user");

    expect(steps.filter((step) => step.phase === "cancel")).toHaveLength(1);
    expect(steps.some((step) => step.phase === "resume" || step.phase === "exit")).toBe(false);
    expect(steps.filter((step) => step.phase === "cancel")[0].effect).toBeUndefined();
  });

  it("sends remote cancellation through the driver transport", async () => {
    let resolveResult!: (message: { id: string; ok: boolean; value?: unknown }) => void;
    const resultListeners: Array<(message: { id: string; ok: boolean; value?: unknown }) => void> = [];
    const cancelled: Array<{ id: string; reason: string }> = [];
    const client = {
      requestYield: async () => {},
      cancelYield: async (_endpoint: string, payload: { id: string; reason: string }) => {
        cancelled.push(payload);
      },
      onYieldResult: (listener: (message: { id: string; ok: boolean; value?: unknown }) => void) => {
        resultListeners.push(listener);
        return () => {};
      },
    };
    const driver = new RemoteYieldDriver({ client });
    const token = createToken();
    const request = {
      id: "yield-1",
      locator: { kind: "remote", endpoint: "remote://test", locator: "child" },
      ctx: { executionId: "exec-1" } as YieldRequest["ctx"],
      cancelToken: token,
    } as YieldRequest;

    const pending = driver.requestYield(request);
    const cancellation = expect(pending).rejects.toThrow("cancelled:user");
    token.cancel("user");

    await cancellation;
    expect(cancelled).toEqual([{ id: "yield-1", executionId: "exec-1", reason: "user" }]);
    void resolveResult;
    void resultListeners;
    driver.dispose();
  });
});
