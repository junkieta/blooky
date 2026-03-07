import { stream, hold, vertex } from "../blooky-fp";
import type { FVRuntime } from "../blooky-fv";
import type { DripperStream, Prop } from "../blooky-fp-types";
import {
  CommitConflictError,
  CommitDripPlan,
  CommitExecutionError,
  CommitRuntime,
  DripConflictError,
  FatalHandler,
  ObservedTick,
  SubmitError,
  createCommitRuntime,
} from "./commit-runtime";
import { createRafScheduler } from "./scheduler";
import { createTickGate } from "./tick-gate";

type TickObserver = (tick: ObservedTick) => void;

type Clock = Prop<number> &
  FVRuntime & {
    observeTick: (f: TickObserver) => () => void;
    unobserveTick: (f: TickObserver) => void;
    setMergeStrategy: <V>(dripper: DripperStream<V>, reducer: (a: V, b: V) => V) => void;
    deleteMergeStrategy: <V>(dripper: DripperStream<V>) => void;
    // backward-compatible aliases
    setConflictReducer: <V>(dripper: DripperStream<V>, reducer: (a: V, b: V) => V) => void;
    deleteConflictReducer: <V>(dripper: DripperStream<V>) => void;
  };

const beat$ = stream<number>();
const scheduler = createRafScheduler();
const gate = createTickGate();

const runtime: CommitRuntime = createCommitRuntime({
  scheduler,
  gate,
  buildBeatPlan: (t) => ({ dripper: beat$, value: t }),
  shouldKeepAlive: () => vertex(beat$).props.length > 1,
});

export const clock: Clock = Object.assign(hold(0)(beat$), {
  submitPlan: runtime.submitPlan,
  observeCommit: runtime.observeCommit,
  unobserveCommit: runtime.unobserveCommit,
  observeTick: runtime.observeTick,
  unobserveTick: runtime.unobserveTick,
  setMergeStrategy: gate.setMergeStrategy,
  deleteMergeStrategy: gate.deleteMergeStrategy,
  // aliases (migration path)
  setConflictReducer: gate.setMergeStrategy,
  deleteConflictReducer: gate.deleteMergeStrategy,
});

export const setFatalHandler = (handler: FatalHandler) => {
  runtime.setFatalHandler(handler);
};

export const time = { tick: runtime.submitPlan, clock, setFatalHandler };

export {
  SubmitError,
  CommitConflictError,
  DripConflictError,
  CommitExecutionError,
};
export type { CommitDripPlan, ObservedTick, FatalHandler };

