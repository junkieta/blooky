import type { DripperStream, DripPlan } from "../blooky-fp-types";
import type { FrameObserver, FrameRecord, PerformanceStep, StepObserver } from "../blooky-fx-types";

export type BridgeEffect =
  | {
      kind: "done";
      dripper: DripperStream<any>;
      value: unknown;
    };

export type RuntimeBridge = {
  onStep: (step: PerformanceStep) => Promise<void>;
  observeStep: (fn: StepObserver) => () => void;
  observeFrame: (fn: FrameObserver) => () => void;
};

export const createDefaultBridge = (deps: {
  submitPlan: (plan: DripPlan<any>) => Promise<unknown>;
}): RuntimeBridge => {
  const stepObservers = new Set<StepObserver>();
  const frameObservers = new Set<FrameObserver>();

  const observeStep: RuntimeBridge["observeStep"] = (fn) => {
    stepObservers.add(fn);
    return () => stepObservers.delete(fn);
  };
  const observeFrame: RuntimeBridge["observeFrame"] = (fn) => {
    frameObservers.add(fn);
    return () => frameObservers.delete(fn);
  };

  const emitMonitoringStep = (step: PerformanceStep) => {
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
            console.error("[bridge] StepObserver async error (isolated)", e);
          });
        }
      } catch (e) {
        console.error("[bridge] StepObserver error (isolated)", e);
      }
    });
  };
  const emitMonitoringFrame = (frame: FrameRecord) => {
    if (!frameObservers.size) return;
    frameObservers.forEach((observer) => {
      try {
        const maybePromise = observer(frame);
        if (
          maybePromise &&
          typeof (maybePromise as any).then === "function" &&
          typeof (maybePromise as any).catch === "function"
        ) {
          (maybePromise as Promise<unknown>).catch((e) => {
            console.error("[bridge] FrameObserver async error (isolated)", e);
          });
        }
      } catch (e) {
        console.error("[bridge] FrameObserver error (isolated)", e);
      }
    });
  };

  const applyBoundaryEffect = async (effect: BridgeEffect) => {
    switch (effect.kind) {
      case "done":
        await deps.submitPlan({ dripper: effect.dripper, value: effect.value });
        return;
    }
  };

  const onStep: RuntimeBridge["onStep"] = async (step) => {
    emitMonitoringStep(step);
    const plans: DripPlan<any>[] = [];
    const effect = step.effect as BridgeEffect | undefined;
    if (effect && typeof effect === "object" && (effect as any).kind === "done") {
      const plan = { dripper: effect.dripper, value: effect.value };
      plans.push(plan);
      await applyBoundaryEffect(effect);
    }
    emitMonitoringFrame({ step, plans, timestamp: Date.now() });
  };

  return { onStep, observeStep, observeFrame };
};
