import type { DripperStream, DripPlan } from "../blooky-fp-types";
import type { FVRuntime } from "../blooky-fv";
import type { FrameObserver, FrameRecord, PerformanceStep } from "../blooky-fx-types";

export type BridgeEffect =
  | {
      kind: "done";
      dripper: DripperStream<any>;
      value: unknown;
    };

export type RuntimeBridge = {
  onStep: (step: PerformanceStep) => Promise<void>;
  observeFrame: (fn: FrameObserver) => () => void;
};

export const createDefaultBridge = (deps: {
  runtime: Pick<FVRuntime, "submitPlan">;
}): RuntimeBridge => {
  const frameObservers = new Set<FrameObserver>();
  const observeFrame: RuntimeBridge["observeFrame"] = (fn) => {
    frameObservers.add(fn);
    return () => frameObservers.delete(fn);
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
        await deps.runtime.submitPlan({ dripper: effect.dripper, value: effect.value });
        return;
    }
  };

  const onStep: RuntimeBridge["onStep"] = async (step) => {
    const plans: DripPlan<any>[] = [];
    const effect = step.effect as BridgeEffect | undefined;
    if (effect && typeof effect === "object" && (effect as any).kind === "done") {
      const plan = { dripper: effect.dripper, value: effect.value };
      plans.push(plan);
      await applyBoundaryEffect(effect);
    }
    emitMonitoringFrame({ step, plans, timestamp: Date.now() });
  };

  return { onStep, observeFrame };
};
