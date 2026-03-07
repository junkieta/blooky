import type { PerformanceStep, StepObserver } from "../blooky-fx-types";

const stepObservers = new Set<StepObserver>();

export const observeRuntimeStep = (observer: StepObserver): (() => void) => {
  stepObservers.add(observer);
  return () => {
    stepObservers.delete(observer);
  };
};

export const emitRuntimeStep = (step: PerformanceStep): void => {
  if (!stepObservers.size) return;
  stepObservers.forEach((observer) => {
    try {
      const maybePromise = observer(step);
      if (
        maybePromise &&
        typeof (maybePromise as any).then === "function" &&
        typeof (maybePromise as any).catch === "function"
      ) {
        (maybePromise as Promise<unknown>).catch((e) => {
          console.error("[runtime-fx] Step observer async error (isolated)", e);
        });
      }
    } catch (e) {
      console.error("[runtime-fx] Step observer error (isolated)", e);
    }
  });
};

