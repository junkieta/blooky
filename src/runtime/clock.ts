import { stream, drip, hold, commit, vertex } from "../blooky-fp";
import { FVRuntime, ObservedDripPlan } from "../blooky-fv";
import { DripperStream, DripPlan, Prop, PropPlan } from "../blooky-fp-types";

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
  setConflictReducer: <V>(dripper: DripperStream<V>, reducer: (a:V,b:V)=>V) => void
  deleteConflictReducer: <V>(dripper: DripperStream<V>) => void
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

export class CommitConflictError extends SubmitError {
  name = "CommitConflictError";
  constructor(readonly conflicts: Map<Prop<any>,any[]>) {
    super("Conflict in CommitPlan");
  }
}

export class DripConflictError extends SubmitError {
  name = "DripConflictError";
  constructor(readonly conflicts: Map<DripperStream<any>,any[]>) {
    super("Conflict in DripPlan");
  }
}


class CommitExecutionError extends Error {
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

const tickQueue: Reservation[] = [];
let fatalState: CommitExecutionError | null = null;

const conflictReducers = new WeakMap<DripperStream<any>, (a:any,b:any)=>any>();

const clockObservers = new Map<(plan: ObservedDripPlan) => void, Set<Prop<unknown>>>();

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

const buildCommitIntent = (t: number, reservations: Reservation[]) => {
  const conflicts = new Map<DripperStream<any>, any[]>();
  const reservedPlans = new Map<DripperStream<any>, any>();
  reservations.forEach(({plan})=>{
    const {dripper,value} = plan;
    if(!reservedPlans.has(dripper)) {
      reservedPlans.set(dripper, value);
    }
    else if(conflictReducers.has(dripper)) {
      const reducer = conflictReducers.get(dripper)!;
      const existsPlan = reservedPlans.get(dripper)!;
      reservedPlans.set(dripper, reducer(existsPlan, value));
    }
    else if(conflicts.has(dripper)) {
      conflicts.set(dripper,conflicts.get(dripper)!.concat(value));
    }
    else {
      conflicts.set(dripper,[reservedPlans.get(dripper)!, value]);
    }
  });

  const reservedPropPlans = [...reservedPlans.entries()].flatMap(([dripper,value])=>drip({dripper,value}));
  // ※ここで "clock由来の派生plan" を追加する（仕様上は runtime の責務）
  const beatPropPlan = drip({ dripper: beat$, value: t });
  return {
    commitIntent: beatPropPlan.concat(reservedPropPlans),
    conflicts
  }

};

type Eq = (a: unknown, b: unknown) => boolean;

/**
 * DripPlan を正規化しつつ、異値重複のみ conflicts として収集する。
 * - 同値重複は dedup（MAY）
 * - 異値重複は conflicts に記録（first も含める）
 */
const normalizePlan = (
  plan: PropPlan<any>[],
  equals: Eq = Object.is
): { commitPlanMap: Map<Prop<any>, any>, conflicts: Map<Prop<any>, any[]> } => {
  const commitPlanMap = new Map<Prop<any>, any>();
  const conflicts = new Map<Prop<any>, any[]>();

  for (const [p, v] of plan) {
    if (!commitPlanMap.has(p)) {
      commitPlanMap.set(p, v);
      continue;
    }

    const prev = commitPlanMap.get(p);
    if (equals(prev, v)) {
      // 同値重複は無視（dedup）
      continue;
    }

    // 異値：conflicts に first+others を集める
    const arr = conflicts.get(p);
    if (arr) {
      arr.push(v);
    } else {
      conflicts.set(p, [prev, v]); // ← first を入れる
    }
  }

  return { commitPlanMap, conflicts };
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

const notifyAllObservers = (commitPlanMap: CommitDripPlan) => {
  const errors: Error[] = [];
  // Bridge Tick Payload を確定（pre-commit）
  const observedTick = buildObservedTick(commitPlanMap);
  // ObservedTick を通知（pre-commit）
  tickObservers.forEach((f) => handleObserver(async()=>f(observedTick), errors));
  if(errors.length) {
    console.error("bridgeTickObserver: thrown errors", ...errors);
    // 隔離方針：observer例外は commit 成否に影響させない
  }

  // ObservedDripPlan を通知
  const prop_all = new Set(commitPlanMap.keys());
  clockObservers.forEach((props, f) => {
    // subset: props に含まれるものだけ抜く
    const subset = prop_all.intersection(props);
    // commitPlanMap は conflict-free を前提に Map 化（subset）
    if (subset.size)
      handleObserver(async()=>f(new Map([...subset].map((p)=>[p,commitPlanMap.get(p)!])) as any), errors);
  });
  if (errors.length) {
    console.error("clockObserver: thrown errors", ...errors);
    // 隔離方針：observer例外は commit 成否に影響させない
  }
}

const handleObserver = (observer:()=>Promise<unknown>, errors: Error[]) => {
  try {
    const maybePromise = observer();
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
  } catch(err) {
    errors.push(err);
  }
}


const advanceClock = () => {
  if (clockRunning) return;

  clockRunning = scheduler((t: number) => {
    clockRunning = 0;
    if (fatalState) return;

    if (!tickQueue.length && !clockObservers.size && !tickObservers.size) return;

    const reservations = tickQueue.splice(0);

    // CommitPlan (= commit-intent) を確定
    const builtPlan = buildCommitIntent(t, reservations);

    // DripConflict を事前検出（conflict があれば commit も observer も呼ばない）
    if(builtPlan.conflicts.size) {
      const err = new DripConflictError(builtPlan.conflicts);
      reservations.forEach(({ reject }) => reject(err));
      // 次tickへ（予約は失敗確定）
      advanceClock();
      return;
    }

    // CommitConflict を事前検出（drip同様、conflict があれば commit も observer も呼ばない）
    const { commitPlanMap, conflicts } = normalizePlan(builtPlan.commitIntent/**, equals */);
    if (conflicts.size) {
      const err = new CommitConflictError(conflicts);
      reservations.forEach(({ reject }) => reject(err));
      // 次tickへ（予約は失敗確定）
      advanceClock();
      return;
    }

    // Observer呼び出し（TickObserver, ClockObserver）
    notifyAllObservers(commitPlanMap);

    // commit（本来 throw しない前提。throw したら停止級）
    try {
      commit([...commitPlanMap]);
    } catch (err) {
      const fatal = new CommitExecutionError(err);
      // fatal は submit reject 経路に載せず、停止経路へ移行。
      enterFatalState(fatal); return;
    }

    // 6) resolve（commit 成功）
    reservations.forEach(({ resolve }) => resolve(commitPlanMap));

    // clockが別のPropに派生していれば、常に次のtickを呼ぶ(clockを更新する)
    if (tickQueue.length || vertex(beat$).props.length > 1) advanceClock();
  });
};

const tick = (plan: DripPlan<any>) => {
  if (fatalState) throw fatalState;
  return new Promise<ObservedDripPlan>((resolve, reject) => {
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

  setConflictReducer<V>(dripper: DripperStream<V>, reducer: (a:V,b:V) => V) {
    conflictReducers.set(dripper, reducer);
  },

  deleteConflictReducer<V>(dripper: DripperStream<V>) {
    conflictReducers.delete(dripper);
  },

  submitPlan: tick,
});

export const setFatalHandler = (handler: FatalHandler) => {
  fatalHandler = handler;
};

export const time = { tick, clock, setFatalHandler };
