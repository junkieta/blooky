import { commit, concatenate } from "../blooky-fp";
import type { FVRuntime, ObservedDripPlan } from "../blooky-fv";
import type { DripPlan, DripperStream, Prop, PropPlan } from "../blooky-fp-types";
import type { TickScheduler } from "./scheduler";
import type { TickGate } from "./tick-gate";

export type CommitDripPlan = Map<Prop<any>, any>;

export type ObservedTick = {
  tick_index: number;
  tick_id: string | number;
  timestamp: number;
  effects_summary: CommitDripPlan;
};

export type TickObserver = (tick: ObservedTick) => void;
export type FatalHandler = (error: CommitExecutionError) => void;

export class SubmitError extends Error {
  name = "SubmitError";
}

export class CommitConflictError extends SubmitError {
  name = "CommitConflictError";
  constructor(readonly conflicts: Map<Prop<any>, any[]>) {
    super("Conflict in CommitPlan");
  }
}

export class DripConflictError extends SubmitError {
  name = "DripConflictError";
  constructor(readonly conflicts: Map<DripperStream<any>, any[]>) {
    super("Conflict in DripPlan");
  }
}

export class CommitExecutionError extends Error {
  readonly name = "CommitExecutionError";
  constructor(readonly cause: unknown) {
    super("Commit execution failed");
  }
}

type Reservation = {
  plan: DripPlan<any>;
  resolve: (v: ObservedDripPlan) => void;
  reject: (v: unknown) => void;
};

type Eq = (a: unknown, b: unknown) => boolean;

export type CommitRuntime = FVRuntime & {
  observeTick: (f: TickObserver) => () => void;
  unobserveTick: (f: TickObserver) => void;
  setFatalHandler: (handler: FatalHandler) => void;
};

export const createCommitRuntime = (deps: {
  scheduler: TickScheduler;
  gate: TickGate;
  buildBeatPlan: (t: number) => DripPlan<any>;
  shouldKeepAlive?: () => boolean;
}): CommitRuntime => {
  const tickQueue: Reservation[] = [];
  const clockObservers = new Map<(plan: ObservedDripPlan) => void, Set<Prop<unknown>>>();
  const tickObservers = new Set<TickObserver>();

  let tickIndexCounter = 0;
  let clockRunning = false;
  let fatalState: CommitExecutionError | null = null;

  let fatalHandler: FatalHandler = (error) => {
    const maybeProcess = (globalThis as any).process;
    if (maybeProcess && typeof maybeProcess.exit === "function") {
      console.error("fatal: commit execution failed", error);
      maybeProcess.exit(1);
      return;
    }
    console.error("fatal: commit execution failed", error);
  };

  const buildObservedTick = (commitPlan: CommitDripPlan): ObservedTick => {
    const tick_index = tickIndexCounter++;
    return {
      tick_index,
      tick_id: tick_index,
      timestamp: Date.now(),
      effects_summary: commitPlan,
    };
  };

  const handleObserver = (observer: () => Promise<unknown>, errors: Error[]) => {
    try {
      const maybePromise = observer();
      if (
        maybePromise &&
        typeof (maybePromise as any).then === "function" &&
        typeof (maybePromise as any).catch === "function"
      ) {
        (maybePromise as Promise<unknown>).catch((err) => {
          console.error("runtimeObserver: async thrown error", err);
        });
      }
    } catch (err) {
      errors.push(err as Error);
    }
  };

  const notifyAllObservers = (commitPlanMap: CommitDripPlan) => {
    const errors: Error[] = [];
    const observedTick = buildObservedTick(commitPlanMap);

    tickObservers.forEach((f) => handleObserver(async () => f(observedTick), errors));
    if (errors.length) console.error("runtimeTickObserver: thrown errors", ...errors);

    const propAll = new Set(commitPlanMap.keys());
    clockObservers.forEach((props, f) => {
      const subset = propAll.intersection(props);
      if (subset.size) {
        handleObserver(
          async () =>
            f(
              new Map([...subset].map((p) => [p, commitPlanMap.get(p)!])) as ObservedDripPlan
            ),
          errors
        );
      }
    });
    if (errors.length) console.error("runtimeCommitObserver: thrown errors", ...errors);
  };

  const enterFatalState = (error: CommitExecutionError) => {
    fatalState = error;
    tickQueue.length = 0;
    clockRunning = false;
    fatalHandler(error);
  };

  const advanceClock = () => {
    if (clockRunning) return;
    clockRunning = true;
    deps.scheduler.request((t) => {
      clockRunning = false;
      if (fatalState) return;
      if (!tickQueue.length && !clockObservers.size && !tickObservers.size && !deps.shouldKeepAlive?.()) {
        return;
      }

      const reservations = tickQueue.splice(0);
      const builtPlan = deps.gate.build(t, reservations.map((r) => r.plan), deps.buildBeatPlan(t));

      if (builtPlan.dripConflicts.size) {
        const err = new DripConflictError(builtPlan.dripConflicts);
        reservations.forEach(({ reject }) => reject(err));
        advanceClock();
        return;
      }

      const {plan,conflicts} = concatenate(builtPlan.commitIntent);

      if (conflicts.size) {
        const err = new CommitConflictError(conflicts);
        reservations.forEach(({ reject }) => reject(err));
        advanceClock();
        return;
      }

      notifyAllObservers(plan);

      try {
        commit([...plan]);
      } catch (err) {
        enterFatalState(new CommitExecutionError(err));
        return;
      }

      reservations.forEach(({ resolve }) => resolve(plan));
      if (tickQueue.length || deps.shouldKeepAlive?.()) advanceClock();
    });
  };

  const submitPlan: FVRuntime["submitPlan"] = (plan: DripPlan<any>) => {
    if (fatalState) throw fatalState;
    return new Promise<ObservedDripPlan>((resolve, reject) => {
      tickQueue.push({ plan, resolve, reject });
      advanceClock();
    });
  };

  const observeCommit: FVRuntime["observeCommit"] = (f) => {
    return (p) => {
      if (!clockObservers.has(f)) clockObservers.set(f, new Set([p]));
      else clockObservers.get(f)!.add(p);
      return unobserveCommit(f).bind(null, p);
    };
  };

  const unobserveCommit: FVRuntime["unobserveCommit"] = (f) => {
    return (p) => {
      if (!clockObservers.has(f)) return;
      if (!p) {
        clockObservers.delete(f);
      } else {
        const props = clockObservers.get(f)!;
        props.delete(p);
        if (!props.size) clockObservers.delete(f);
      }
    };
  };

  const observeTick = (f: TickObserver) => {
    tickObservers.add(f);
    return () => {
      tickObservers.delete(f);
    };
  };

  const unobserveTick = (f: TickObserver) => {
    tickObservers.delete(f);
  };

  return {
    submitPlan,
    observeCommit,
    unobserveCommit,
    observeTick,
    unobserveTick,
    setFatalHandler: (handler) => {
      fatalHandler = handler;
    },
  };
};

