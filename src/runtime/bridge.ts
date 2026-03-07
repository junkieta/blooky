import type { DripperStream } from "../blooky-fp-types";
import type { FVRuntime } from "../blooky-fv";
import type { PerformanceStep } from "../blooky-fx-types";

export type BridgeEffect =
  | {
      kind: "done";
      dripper: DripperStream<any>;
      value: unknown;
    };

export type RuntimeBridge = {
  onStep: (step: PerformanceStep) => Promise<void>;
};

export const createDefaultBridge = (deps: {
  runtime: Pick<FVRuntime, "submitPlan">;
}): RuntimeBridge => {
  const applyBoundaryEffect = async (effect: BridgeEffect) => {
    switch (effect.kind) {
      case "done":
        await deps.runtime.submitPlan({ dripper: effect.dripper, value: effect.value });
        return;
    }
  };

  const onStep: RuntimeBridge["onStep"] = async (step) => {
    const effect = step.effect as BridgeEffect | undefined;
    if (effect && typeof effect === "object" && (effect as any).kind === "done") {
      await applyBoundaryEffect(effect);
    }
  };

  return { onStep };
};
