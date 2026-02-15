import { stream, drip, hold, commit, conflict } from "../blooky-fp";
import { FVRuntime, ObservedDripPlan } from "../blooky-fv";
import { DripPlan, Prop } from "../blooky-types";

type Clock = Prop<number> & FVRuntime;

const beat$ = stream<number>();
const scheduler =
  globalThis.requestAnimationFrame ||
  ((f: (t: number) => void) =>
    setTimeout(() => f(performance.now()), Math.ceil(1000 / 60)));

class ConflictError extends Error {
  readonly name = "ConflictError";
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

const clockObservers = new Map<
  (plan: ObservedDripPlan) => void,
  Set<Prop<unknown>>
>();

let clockRunning: number | NodeJS.Timeout = 0;

const buildCommitIntent = (t: number, reservations: Reservation[]): DripPlan => {
  // clock派生 (beat$) + submitされたplans を合成
  // ※ここで必要なら "clock由来の派生plan" を追加する（仕様上は runtime の責務）
  return drip(t)(beat$).concat(...reservations.map(({ plan }) => plan));
};

const notifyClockObservers = (commitIntent: DripPlan): Error[] => {
  const errors: Error[] = [];
  // commitIntent は conflict-free を前提に Map 化（subset）
  clockObservers.forEach((props, f) => {
    // subset: props に含まれるものだけ抜く
    const subset = commitIntent.filter(([p]) => props.has(p));
    if (!subset.length) return;

    try {
      f(new Map(subset) as any);
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

    if (!tickQueue.length && !clockObservers.size) return;

    const reservations = tickQueue.splice(0);

    // 1) CommitPlan (= commit-intent) を確定
    const commitIntent = buildCommitIntent(t, reservations);

    // 2) conflict を事前検出（conflict があれば commit も observer も呼ばない）
    const conflicts = conflict(commitIntent);
    if (conflicts.size) {
      const err = new ConflictError(conflicts);
      reservations.forEach(({ reject }) => reject(err));
      // 次tickへ（予約は失敗確定）
      advanceClock();
      return;
    }

    // 3) ObservedPlan（subset view）を通知（pre-commit）
    const obsErrors = notifyClockObservers(commitIntent);
    if (obsErrors.length) {
      console.error("clockObserver: thrown errors", ...obsErrors);
      // 隔離方針：observer例外は commit 成否に影響させない
    }

    // 4) commit（本来 throw しない前提。throw したら停止級）
    try {
      commit(commitIntent);
    } catch (err) {
      const fatal = new CommitExecutionError(err);
      reservations.forEach(({ reject }) => reject(fatal));
      // 停止級：通常のreject経路として扱わない、という方針なら再throwして落とす
      throw fatal;
    }

    // 5) resolve（commit 成功）
    reservations.forEach(({ resolve }) => resolve(commitIntent));

    advanceClock();
  });
};

const tick = (plan: DripPlan) =>
  new Promise<DripPlan>((resolve, reject) => {
    tickQueue.push({ plan, resolve, reject });
    advanceClock();
  });

export const clock: Clock = Object.assign<Prop<number>, FVRuntime>(hold(0)(beat$), {
  observe(f: (plan: ObservedDripPlan) => void) {
    return (p: Prop<any>) => {
      if (!clockObservers.has(f)) clockObservers.set(f, new Set([p]));
      else clockObservers.get(f)!.add(p);
      return clock.unobserve(f).bind(null, p);
    };
  },

  unobserve(f: (plan: ObservedDripPlan) => void) {
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

  submit: tick,
});

export const time = { tick, clock };
