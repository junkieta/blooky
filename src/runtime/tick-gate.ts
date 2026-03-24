import { drip } from "../blooky-fp";
import type { DripPlan, DripperStream, PropPlan } from "../blooky-fp-types";

export type MergeStrategy<V> = (prev: V, next: V) => V;

export type TickGateBuildResult = {
  commitIntent: PropPlan<any>[];
  dripConflicts: Map<DripperStream<any>, any[]>;
};

export type TickGate = {
  setMergeStrategy: <V>(dripper: DripperStream<V>, reducer: MergeStrategy<V>) => void;
  deleteMergeStrategy: <V>(dripper: DripperStream<V>) => void;
  build: (t: number, plans: DripPlan<any>[], beatPlan?: DripPlan<any>) => TickGateBuildResult;
};

export const createTickGate = (): TickGate => {
  const mergeStrategies = new WeakMap<DripperStream<any>, MergeStrategy<any>>();

  const setMergeStrategy: TickGate["setMergeStrategy"] = (dripper, reducer) => {
    mergeStrategies.set(dripper, reducer);
  };

  const deleteMergeStrategy: TickGate["deleteMergeStrategy"] = (dripper) => {
    mergeStrategies.delete(dripper);
  };

  const build: TickGate["build"] = (_t, plans, beatPlan) => {
    const dripConflicts = new Map<DripperStream<any>, any[]>();
    const mergedPlans = new Map<DripperStream<any>, any>();

    plans
    .map((plan) => Array.isArray(plan) ? plan : [plan.dripper, plan.value] as const)
    .forEach(([dripper,value]) => {
      if (!mergedPlans.has(dripper)) {
        mergedPlans.set(dripper, value);
      } else if (mergeStrategies.has(dripper)) {
        const reducer = mergeStrategies.get(dripper)!;
        const prev = mergedPlans.get(dripper)!;
        mergedPlans.set(dripper, reducer(prev, value));
      } else if (dripConflicts.has(dripper)) {
        dripConflicts.set(dripper, dripConflicts.get(dripper)!.concat(value));
      } else {
        dripConflicts.set(dripper, [mergedPlans.get(dripper)!, value]);
      }
    });

    const reservedPropPlans = [...mergedPlans.entries()].flatMap(([dripper, value]) =>
      drip({ dripper, value })
    );
    const beatPropPlans = beatPlan ? drip(beatPlan) : [];

    return {
      commitIntent: beatPropPlans.concat(reservedPropPlans),
      dripConflicts,
    };
  };

  return {
    setMergeStrategy,
    deleteMergeStrategy,
    build,
  };
};

