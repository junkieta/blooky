import { stream, drip, hold, commit, conflict } from "../blooky-fp";
import { FVRuntime, ObservedDripPlan } from "../blooky-fv";
import { DripPlan, Prop } from "../blooky-fp-types";

export type CommitDripPlan = Map<Prop<any>,any>;

export type ObservedTick = {
  tick_index: number;
  tick_id: string | number;
  timestamp: number;
  effects_summary: CommitDripPlan;
};

type TickObserver = (tick: ObservedTick) => void;

type Clock = Prop<number> & FVRuntime & {
    observeTick: (f: TickObserver) => () => void;
    unobserveTick: (f: TickObserver) => void;
  };

type FatalHandler = (error: CommitExecutionError) => void;

const beat$ = stream<number>();
const scheduler =
  globalThis.requestAnimationFrame ||
  ((f: (t: number) => void) =>
    setTimeout(() => f(performance.now()), Math.ceil(1000 / 60)));

export class SubmitError extends Error {
  name = "SubmitError";
}

export class SubmitConflictError extends SubmitError {
  name = "SubmitConflictError";
  constructor(readonly conflicts: Set<Prop<any>>) {
    super("Conflict in CommitPlan");
  }
}

class CommitExecutionError extends Error {
  readonly name = "CommitExecutionError";
  constructor(readonly cause: unknown) {
    super("Commit execution failed");
  }
}

type Reservation = {
  plan: DripPlan;
  resolve: (v: DripPlan) => void;
  reject: (v: unknown) => void;
};

const tickQueue: Reservation[] = [];
let fatalState: CommitExecutionError | null = null;

const clockObservers = new Map<
  (plan: ObservedDripPlan) => void,
  Set<Prop<unknown>>
>();

const tickObservers = new Set<TickObserver>();
let tickIndexCounter = 0;

let clockRunning: number | NodeJS.Timeout = 0;
let fatalHandler: FatalHandler = (error) => {
  // Host-defined fatal path (default behavior)
  // Node.js: terminate process if available.
  const maybeProcess = (globalThis as any).process;
  if (maybeProcess && typeof maybeProcess.exit === "function") {
    console.error("fatal: commit execution failed", error);
    maybeProcess.exit(1);
    return;
  }
  // Browser/other hosts: surface the error explicitly.
  console.error("fatal: commit execution failed", error);
};

const enterFatalState = (error: CommitExecutionError) => {
  fatalState = error;
  tickQueue.length = 0;
  clockRunning = 0;
  fatalHandler(error);
};

const buildCommitIntent = (t: number, reservations: Reservation[]): DripPlan => {
  // clock派生 (beat$) + submitされたplans を合成
  // ※ここで必要なら "clock由来の派生plan" を追加する（仕様上は runtime の責務）
  return drip(t)(beat$).concat(...reservations.map(({ plan }) => plan));
};

const notifyClockObservers = (commitIntent: CommitDripPlan): Error[] => {
  const errors: Error[] = [];
  const prop_all = new Set(commitIntent.keys());
  // commitIntent は conflict-free を前提に Map 化（subset）
  clockObservers.forEach((props, f) => {
    // subset: props に含まれるものだけ抜く
    const subset = prop_all.intersection(props);
    if (!subset.size) return;

    try {
      const maybePromise = (f as (plan: ObservedDripPlan) => unknown)(
        new Map([...subset].map((p)=>[p,commitIntent.get(p)!])) as any
      );
      // Observer async failure is isolated from submit/commit result.
      if (
        maybePromise &&
        typeof (maybePromise as any).then === "function" &&
        typeof (maybePromise as any).catch === "function"
      ) {
        (maybePromise as Promise<unknown>).catch((err) => {
          console.error("clockObserver: async thrown error", err);
        });
      }
    } catch (err) {
      errors.push(err as Error);
    }
  });
  return errors;
};

const buildObservedTick = (commitPlan: CommitDripPlan): ObservedTick => {
  const tick_index = tickIndexCounter++;
  return {
    tick_index,
    tick_id: tick_index,
    timestamp: Date.now(),
    effects_summary: commitPlan
  };
};

const notifyBridgeTickObservers = (observedTick: ObservedTick): Error[] => {
  const errors: Error[] = [];
  tickObservers.forEach((f) => {
    try {
      const maybePromise = (f as (tick: ObservedTick) => unknown)(observedTick);
      if (
        maybePromise &&
        typeof (maybePromise as any).then === "function" &&
        typeof (maybePromise as any).catch === "function"
      ) {
        (maybePromise as Promise<unknown>).catch((err) => {
          console.error("bridgeTickObserver: async thrown error", err);
        });
      }
    } catch (err) {
      errors.push(err as Error);
    }
  });
  return errors;
};

const advanceClock = () => {
  if (clockRunning) return;

  clockRunning = scheduler((t: number) => {
    clockRunning = 0;
    if (fatalState) return;

    if (!tickQueue.length && !clockObservers.size) return;

    const reservations = tickQueue.splice(0);

    // 1) CommitPlan (= commit-intent) を確定
    const commitIntent = buildCommitIntent(t, reservations);

    // 2) conflict を事前検出（conflict があれば commit も observer も呼ばない）
    const conflicts = conflict(commitIntent);
    if (conflicts.size) {
      const err = new SubmitConflictError(conflicts);
      reservations.forEach(({ reject }) => reject(err));
      // 次tickへ（予約は失敗確定）
      advanceClock();
      return;
    }

    // observerに渡すためconflict無しを保証した後Mapに変換
    const commitPlanMap = new Map(commitIntent);

    // 3) Bridge Tick Payload を確定（pre-commit）
    const observedTick = buildObservedTick(commitPlanMap);

    // 3) ObservedPlan（subset view）を通知（pre-commit）
    const tickObsErrors = notifyBridgeTickObservers(observedTick);
    if (tickObsErrors.length) {
      console.error("bridgeTickObserver: thrown errors", ...tickObsErrors);
      // 隔離方針：observer例外は commit 成否に影響させない
    }

    const obsErrors = notifyClockObservers(commitPlanMap);
    if (obsErrors.length) {
      console.error("clockObserver: thrown errors", ...obsErrors);
      // 隔離方針：observer例外は commit 成否に影響させない
    }

    // 4) commit（本来 throw しない前提。throw したら停止級）
    try {
      commit(commitIntent);
    } catch (err) {
      const fatal = new CommitExecutionError(err);
      // fatal は submit reject 経路に載せず、停止経路へ移行。
      enterFatalState(fatal); return;
    }

    // 5) resolve（commit 成功）
    reservations.forEach(({ resolve }) => resolve(commitIntent));

    advanceClock();
  });
};

const tick = (plan: DripPlan) => {
  if (fatalState) throw fatalState;
  return new Promise<DripPlan>((resolve, reject) => {
    tickQueue.push({ plan, resolve, reject });
    advanceClock();
  });
};

export const clock: Clock = Object.assign(hold(0)(beat$), {

  observeCommit(f: (plan: ObservedDripPlan) => void) {
    return (p: Prop<any>) => {
      if (!clockObservers.has(f)) clockObservers.set(f, new Set([p]));
      else clockObservers.get(f)!.add(p);
      return clock.unobserveCommit(f).bind(null, p);
    };
  },

  unobserveCommit(f: (plan: ObservedDripPlan) => void) {
    return (p?: Prop<unknown>) => {
      if (!clockObservers.has(f)) return;
      if (!p) {
        clockObservers.delete(f);
      } else {
        const props = clockObservers.get(f)!;
        props.delete(p);
        if (!props.size) clockObservers.delete(f);
      }
    };
  },

  observeTick(f: TickObserver) {
    tickObservers.add(f);
    return () => {
      tickObservers.delete(f);
    };
  },

  unobserveTick(f: TickObserver) {
    tickObservers.delete(f);
  },

  submitPlan: tick,
});

export const setFatalHandler = (handler: FatalHandler) => {
  fatalHandler = handler;
};

export const time = { tick, clock, setFatalHandler };
