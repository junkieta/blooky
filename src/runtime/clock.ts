// src/runtime/clock.ts
//
// blooky Clock — Tick Transaction Runtime
//
// 統合元: scheduler.ts / tick-gate.ts / commit-runtime.ts
// spec: blooky Clock Specification v1.0.0 §3 Tick Model に対応する。

import { steep, stream, hold, vertex, commit } from "../blooky-fp";
import type { FVRuntime, ObservedCommitPlan } from "../blooky-fv";
import type {
  CommitPlan,
  CommitPlanMap,
  DripPlan,
  DripperStream,
  Prop,
  Vertex,
} from "../blooky-fp-types";
import { createObserverBus } from "./internal/observer-bus";

// ─────────────────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────────────────

export type MergeStrategy<V> = (prev: V, next: V) => V;

export type ObservedTick = {
  tick_index: number;
  tick_id: string | number;
  timestamp: number;
  effects_summary: CommitPlanMap;
};

export type TickObserver = (tick: ObservedTick) => void;
export type FatalHandler = (error: CommitExecutionError) => void;

type Clock = Prop<number> &
  FVRuntime & {
    observeTick: (f: TickObserver) => () => void;
    unobserveTick: (f: TickObserver) => void;
    setMergeStrategy: <V>(dripper: DripperStream<V>, reducer: MergeStrategy<V>) => void;
    deleteMergeStrategy: <V>(dripper: DripperStream<V>) => void;
  };

// ─────────────────────────────────────────────────────────
// エラークラス
// ─────────────────────────────────────────────────────────

export class SubmitError extends Error {
  name = "SubmitError";
}

export class DripConflictError extends SubmitError {
  name = "DripConflictError";
  constructor(readonly conflicts: Map<DripperStream<any>, any[]>) {
    super("Conflict in DripPlan");
  }
}

export class CommitConflictError extends SubmitError {
  name = "CommitConflictError";
  constructor(readonly conflicts: Map<Prop<any>, any[]>) {
    super("Conflict in CommitPlan");
  }
}

export class CommitExecutionError extends Error {
  readonly name = "CommitExecutionError";
  constructor(readonly cause: unknown) {
    super("Commit execution failed");
  }
}

// ─────────────────────────────────────────────────────────
// 内部型
// ─────────────────────────────────────────────────────────

type Reservation = {
  plan: DripPlan<any>;
  resolve: (v: ObservedCommitPlan) => void;
  reject: (v: unknown) => void;
};

type BuildResult = {
  commitIntent: CommitPlan;
  dripConflicts: Map<DripperStream<any>, any[]>;
};

// ─────────────────────────────────────────────────────────
// FRP core: beat$
// ─────────────────────────────────────────────────────────

const beat$ = stream<number>();

// ─────────────────────────────────────────────────────────
// §3.2 Merge Phase — dripper単位のmerge戦略
// ─────────────────────────────────────────────────────────

const mergeStrategies = new WeakMap<DripperStream<any>, MergeStrategy<any>>();

// ─────────────────────────────────────────────────────────
// §3.3 Commit Conflict Detection
// CommitPlan（PropPlan[]）を Map に畳み、値が衝突する Prop を検出する。
// blooky-fp の commit() が throw する前に Clock 側で検出し、
// SubmitError として reject する（§3.3.1 / §8 Fatal の境界を守るため）。
// ─────────────────────────────────────────────────────────

const detectCommitConflicts = (
  plan: CommitPlan
): [CommitPlanMap, Map<Prop<any>, any[]>] => {
  const commits = new Map<Prop<any>, any>();
  const conflicts = new Map<Prop<any>, any[]>();

  for (const [prop, value] of plan) {
    if (!commits.has(prop)) {
      commits.set(prop, value);
    } else if (!Object.is(commits.get(prop), value)) {
      // 異なる値 → Commit Conflict
      const existing = conflicts.get(prop);
      if (existing) {
        existing.push(value);
      } else {
        conflicts.set(prop, [commits.get(prop)!, value]);
        commits.delete(prop);
      }
    }
    // 同値重複は MAY deduplicate（spec §3.3）→ 無視
  }

  return [commits, conflicts];
};

// ─────────────────────────────────────────────────────────
// §3.2 Merge / §3.3 Drip Conflict → CommitPlan 構築
// ─────────────────────────────────────────────────────────

// 修正後
const buildCommitIntent = (t: number, plans: DripPlan<any>[]): BuildResult => {
  const dripConflicts = new Map<DripperStream<any>, any[]>();
  const merged = new Map<DripperStream<any>, any>();

  for (const [dripper, value] of plans) {
    if (!merged.has(dripper)) {
      merged.set(dripper, value);
    } else if (mergeStrategies.has(dripper)) {
      merged.set(dripper, mergeStrategies.get(dripper)!(merged.get(dripper)!, value));
    } else {
      const existing = dripConflicts.get(dripper);
      if (existing) existing.push(value);
      else dripConflicts.set(dripper, [merged.get(dripper)!, value]);
    }
  }

  // beat$ を含む全 DripPlan を steep で一括評価
  // steep がトポロジカルソートと MergedStream の統合を保証する
  const allPlans: DripPlan<any>[] = [
    [beat$, t],
    ...[...merged.entries()] as DripPlan<any>[]
  ];

  return {
    commitIntent: steep(allPlans),
    dripConflicts,
  };
};

// ─────────────────────────────────────────────────────────
// Tick 状態
// ─────────────────────────────────────────────────────────

const tickQueue: Reservation[] = [];
const clockObservers = new Map<(plan: ObservedCommitPlan) => void, Set<Prop<unknown>>>();
const tickBus = createObserverBus<ObservedTick>();

let tickIndexCounter = 0;
let clockRunning = false;
let fatalState: CommitExecutionError | null = null;
let fatalHandler: FatalHandler = (error) => {
  const proc = (globalThis as any).process;
  if (proc && typeof proc.exit === "function") {
    console.error("[clock] fatal:", error);
    proc.exit(1);
    return;
  }
  console.error("[clock] fatal:", error);
};

// ─────────────────────────────────────────────────────────
// beat$ グラフの生存確認
// FRP グラフに Prop が残っている限り Tick を継続する。
// ─────────────────────────────────────────────────────────

const shouldKeepAlive = (): boolean => {
  const visited = new WeakSet<Vertex>();
  const walk = (v: Vertex): boolean => {
    if (visited.has(v)) return false;
    visited.add(v);
    return [...v.next, ...v.lazyNext].some((n) => n.props.length > 0 || walk(n));
  };
  return walk(vertex(beat$));
};

// ─────────────────────────────────────────────────────────
// §3.4 Observer Notify（pre-commit）
// Observer failure は commit 成否に影響しない（spec §5 Observer Notify）。
// ─────────────────────────────────────────────────────────

const callIsolated = (f: () => unknown, errors: Error[]): void => {
  try {
    const result = f();
    if (result && typeof (result as any).catch === "function") {
      (result as Promise<unknown>).catch((e) =>
        console.error("[clock] async observer error (isolated):", e)
      );
    }
  } catch (e) {
    errors.push(e as Error);
  }
};

const notifyObservers = (commits: CommitPlanMap): void => {
  const tick_index = tickIndexCounter++;
  const observedTick: ObservedTick = {
    tick_index,
    tick_id: tick_index,
    timestamp: Date.now(),
    effects_summary: commits,
  };

  const errors: Error[] = [];

  tickBus.emit(observedTick);
  if (errors.length) console.error("[clock] tick observer errors:", ...errors);

  const propAll = new Set(commits.keys());
  clockObservers.forEach((props, f) => {
    const subset = propAll.intersection(props);
    if (!subset.size) return;
    callIsolated(
      () => f(new Map([...subset].map((p) => [p, commits.get(p)!])) as ObservedCommitPlan),
      errors
    );
  });
  if (errors.length) console.error("[clock] commit observer errors:", ...errors);
};

// ─────────────────────────────────────────────────────────
// §8 Fatal
// ─────────────────────────────────────────────────────────

const enterFatalState = (error: CommitExecutionError): void => {
  fatalState = error;
  tickQueue.length = 0;
  clockRunning = false;
  fatalHandler(error);
};

// ─────────────────────────────────────────────────────────
// §9 Scheduler — requestAnimationFrame（host依存でよい）
// ─────────────────────────────────────────────────────────

const requestTick: (cb: (t: number) => void) => void =
  globalThis.requestAnimationFrame?.bind(globalThis) ??
  ((f) => setTimeout(() => f(performance.now()), Math.ceil(1000 / 60)));

// ─────────────────────────────────────────────────────────
// §3 Tick Transaction — メインループ
//
//   Submit → Merge → Conflict Check → Observer Notify → Commit → Resolve
//
// ─────────────────────────────────────────────────────────

const advanceClock = (): void => {
  if (clockRunning) return;
  clockRunning = true;

  requestTick((t) => {
    clockRunning = false;
    if (fatalState) return;

    if (!tickQueue.length && !clockObservers.size && !shouldKeepAlive()) {
      return;
    }

    // §3.1 Submit
    const reservations = tickQueue.splice(0);

    // §3.2 Merge / Drip Conflict
    const { commitIntent, dripConflicts } = buildCommitIntent(
      t,
      reservations.map((r) => r.plan)
    );

    if (dripConflicts.size) {
      const err = new DripConflictError(dripConflicts);
      reservations.forEach(({ reject }) => reject(err));
      advanceClock();
      return;
    }

    // §3.3 Commit Conflict
    const [commits, conflicts] = detectCommitConflicts(commitIntent);
    if (conflicts.size) {
      const err = new CommitConflictError(conflicts);
      reservations.forEach(({ reject }) => reject(err));
      advanceClock();
      return;
    }

    // §3.4 Observer Notify（pre-commit）
    notifyObservers(commits);

    // §4 Atomic Commit
    try {
      commit(commitIntent);
    } catch (err) {
      enterFatalState(new CommitExecutionError(err));
      return;
    }

    // Resolve
    reservations.forEach(({ resolve }) => resolve(commits));

    if (tickQueue.length || shouldKeepAlive()) advanceClock();
  });
};

// ─────────────────────────────────────────────────────────
// FVRuntime 実装
// ─────────────────────────────────────────────────────────

const submitPlan: FVRuntime["submitPlan"] = (plan) => {
  if (fatalState) throw fatalState;
  return new Promise<ObservedCommitPlan>((resolve, reject) => {
    tickQueue.push({ plan, resolve, reject });
    advanceClock();
  });
};

const observeCommit: FVRuntime["observeCommit"] = (f) => (p) => {
  if (!clockObservers.has(f)) clockObservers.set(f, new Set([p]));
  else clockObservers.get(f)!.add(p);
  return () => unobserveCommit(f)(p);
};

const unobserveCommit: FVRuntime["unobserveCommit"] = (f) => (p) => {
  if (!clockObservers.has(f)) return;
  if (!p) {
    clockObservers.delete(f);
  } else {
    const props = clockObservers.get(f)!;
    props.delete(p);
    if (!props.size) clockObservers.delete(f);
  }
};

const observeTick = (f: TickObserver): (() => void) => {
  return tickBus.observe(f);
};

const unobserveTick = (f: TickObserver): void => {
  // No-op: observer-bus handles cleanup via the returned unsubscribe function
};

// ─────────────────────────────────────────────────────────
// clock — 公開インターフェース
// ─────────────────────────────────────────────────────────

export const clock: Clock = Object.assign(hold(0)(beat$), {
  submitPlan,
  observeCommit,
  unobserveCommit,
  observeTick,
  unobserveTick,
  setMergeStrategy: <V>(d: DripperStream<V>, r: MergeStrategy<V>) =>
    mergeStrategies.set(d, r),
  deleteMergeStrategy: <V>(d: DripperStream<V>) => mergeStrategies.delete(d),
});

export const setFatalHandler = (handler: FatalHandler): void => {
  fatalHandler = handler;
};

export const time = { tick: submitPlan, clock, setFatalHandler };

export type { CommitPlanMap };