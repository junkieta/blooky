import type { CancelToken, FxExecution, PerformanceStep } from "../blooky-fx-types";
import { Cancelled } from "./cancel-token";

export type FxStepSink = (step: PerformanceStep) => void | Promise<void>;

export async function runFxExecution<Result>(
  execution: FxExecution<Result>,
  onStep?: FxStepSink,
  cancelToken?: CancelToken,
): Promise<Result> {
  while (true) {
    if (cancelToken?.cancelled()) {
      await execution.return(undefined as never);
      throw new Cancelled(cancelToken.reason ?? "user");
    }

    const state = await execution.next();
    if (cancelToken?.cancelled()) {
      await execution.return(undefined as never);
      throw new Cancelled(cancelToken.reason ?? "user");
    }
    if (state.done) return state.value;
    if (onStep) await onStep(state.value as PerformanceStep);
  }
}
