import type { CancelToken, FxExecution, PerformanceStep } from "../blooky-fx-types";

export type FxStepSink = (step: PerformanceStep) => void | Promise<void>;

export async function runFxExecution<Result>(
  execution: FxExecution<Result>,
  onStep?: FxStepSink,
  cancelToken?: CancelToken,
): Promise<Result> {
  while (true) {
    if (cancelToken?.cancelled()) {
      await execution.return(undefined as never);
      throw new Error(`cancelled:${cancelToken.reason ?? "user"}`);
    }

    const state = await execution.next();
    if (state.done) return state.value;
    if (onStep) await onStep(state.value as PerformanceStep);
  }
}
