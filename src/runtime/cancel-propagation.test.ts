import type { CancelToken, PerformanceStep, YieldRequest } from "../blooky-fx-types";
import { Cancelled, createChildCancelToken } from "./cancel-token";
import { RemoteYieldDriver } from "./yield";
import { runFxExecution } from "./generator-runner";

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

    await expect(running).rejects.toThrow("cancelled:user");
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
