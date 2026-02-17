import { fx, prepare, execute, ref, RETURN_VALUE } from "./blooky-fx";
import type { ExecutionHandle, ExecutionStep, FxNote } from "./blooky-fx-types";

const runButton = document.getElementById("run") as HTMLButtonElement | null;
const cancelButton = document.getElementById("cancel") as HTMLButtonElement | null;
const resolveButton = document.getElementById("resolve") as HTMLButtonElement | null;
const rejectButton = document.getElementById("reject") as HTMLButtonElement | null;
const modeSelect = document.getElementById("mode") as HTMLSelectElement | null;
const featureCheck = document.getElementById("feature") as HTMLInputElement | null;
const loopLimitInput = document.getElementById("loopLimit") as HTMLInputElement | null;
const statusEl = document.getElementById("status") as HTMLDivElement | null;
const pendingEl = document.getElementById("pending") as HTMLDivElement | null;
const summaryEl = document.getElementById("summary") as HTMLDivElement | null;
const logEl = document.getElementById("log") as HTMLPreElement | null;
const confirmTpl = document.getElementById("confirm-template") as HTMLTemplateElement | null;

if (
  !runButton ||
  !cancelButton ||
  !resolveButton ||
  !rejectButton ||
  !modeSelect ||
  !featureCheck ||
  !loopLimitInput ||
  !statusEl ||
  !pendingEl ||
  !summaryEl ||
  !logEl ||
  !confirmTpl
) {
  throw new Error("runtime score-fx demo: required elements are missing");
}

type DemoState = {
  startedAt: string;
  mode: string;
  featureEnabled: boolean;
  loopLimit: number;
  loopCount: number;
  trace: string[];
};

type PendingYieldDetail = { id: string; executionId: string; input?: unknown };

let activeHandle: ExecutionHandle | null = null;
let pendingYieldId: string | null = null;
let stepCount = 0;
const phaseCounter = new Map<string, number>();
const noteCounter = new Map<string, number>();

const setStatus = (text: string) => {
  statusEl.textContent = text;
};

const setPending = (text: string) => {
  pendingEl.textContent = text;
};

const addCount = (map: Map<string, number>, key: string) => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const escape = (s: string) => s.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");

const formatValue = (value: unknown): string => {
  if (value instanceof Error) return `Error(${value.message})`;
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return `Symbol(${value.description ?? ""})`;
  try {
    return escape(JSON.stringify(value));
  } catch {
    return String(value);
  }
};

const appendLog = (line: string) => {
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

const renderSummary = () => {
  const phaseText = [...phaseCounter.entries()]
    .map(([k, v]) => `${k}:${v}`)
    .join("  ");
  const noteText = [...noteCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}:${v}`)
    .join("  ");

  summaryEl.innerHTML = [
    `<span>steps=<b>${stepCount}</b></span>`,
    `<span>phase=<b>${phaseText || "-"}</b></span>`,
    `<span>notes=<b>${noteText || "-"}</b></span>`,
  ].join(" ");
};

const resetView = () => {
  logEl.textContent = "";
  stepCount = 0;
  phaseCounter.clear();
  noteCounter.clear();
  pendingYieldId = null;
  setPending("pending yield: none");
  renderSummary();
};

const stepLogger = (step: ExecutionStep) => {
  stepCount += 1;
  addCount(phaseCounter, step.phase);
  addCount(noteCounter, step.note.type);
  renderSummary();

  const executionId = typeof step.data?.executionId === "string" ? step.data.executionId : "-";
  const noteId = step.note.id ? `#${step.note.id}` : "-";
  appendLog(
    `${String(stepCount).padStart(3, "0")}  phase=${step.phase.padEnd(9, " ")} note=${step.note.type.padEnd(9, " ")} id=${noteId.padEnd(16, " ")} exec=${executionId} data=${formatValue(step.data)}`
  );
};

const buildFlow = (): FxNote => {
  const raceFast = fx.sequence(
    [fx.wait({ ms: 120 }), fx.call(ref("record"), { context: ref("state"), arg: () => "race:fast winner", id: "raceFastCall" })],
    "raceFast"
  );
  const raceSlowA = fx.sequence(
    [fx.wait({ ms: 360 }), fx.call(ref("record"), { context: ref("state"), arg: () => "race:slowA", id: "raceSlowACall" })],
    "raceSlowA"
  );
  const raceSlowB = fx.sequence(
    [fx.wait({ ms: 260 }), fx.call(ref("record"), { context: ref("state"), arg: () => "race:slowB", id: "raceSlowBCall" })],
    "raceSlowB"
  );

  return fx.sequence(
    [
      fx.call(ref("record"), { context: ref("state"), arg: () => "sequence:start", id: "startCall" }),

      fx.parallel(
        [
          fx.sequence([fx.wait({ ms: 80 }), fx.call(ref("record"), { context: ref("state"), arg: () => "parallel:A", id: "parallelA" })], "parallelBranchA"),
          fx.sequence([fx.wait({ ms: 180 }), fx.call(ref("record"), { context: ref("state"), arg: () => "parallel:B", id: "parallelB" })], "parallelBranchB"),
        ],
        "parallelBlock"
      ),

      fx.race([raceSlowA, raceFast, raceSlowB], "raceBlock"),

      fx.condition(
        ref("featureEnabled"),
        fx.call(ref("record"), { context: ref("state"), arg: () => "condition:true", id: "condTrue" }),
        fx.call(ref("record"), { context: ref("state"), arg: () => "condition:false", id: "condFalse" }),
        "conditionBlock"
      ),

      fx.switch(
        ref("mode"),
        new Map([
          ["safe", fx.call(ref("record"), { context: ref("state"), arg: () => "switch:safe", id: "modeSafe" })],
          ["fast", fx.call(ref("record"), { context: ref("state"), arg: () => "switch:fast", id: "modeFast" })],
        ]),
        fx.call(ref("record"), { context: ref("state"), arg: () => "switch:default", id: "modeDefault" }),
        "switchBlock"
      ),

      fx.loop(
        ref("loopContinue"),
        fx.sequence([fx.call(ref("loopTick"), { context: ref("state"), id: "loopTickCall" }), fx.wait({ ms: 60 })], "loopBody"),
        { maxIterations: 8 },
        "loopBlock"
      ),

      fx.yield({
        for: ref("confirmTarget"),
        value: ref("yieldInput"),
        id: "confirm",
      }),

      fx.switch(
        ref("#confirm"),
        new Map([
          ["approve", fx.call(ref("record"), { context: ref("state"), arg: () => "yield:approve", id: "yieldApproved" })],
          ["reject", fx.call(ref("record"), { context: ref("state"), arg: () => "yield:reject", id: "yieldRejected" })],
        ]),
        fx.call(ref("record"), { context: ref("state"), arg: () => "yield:unknown", id: "yieldUnknown" }),
        "yieldSwitch"
      ),

      fx.return(ref("finalize"), "finalReturn"),
    ],
    "root"
  );
};

const makeInitialContext = (): Record<string, unknown> => {
  const loopLimit = Math.max(1, Math.min(8, Number(loopLimitInput.value) || 3));
  const state: DemoState = {
    startedAt: new Date().toISOString(),
    mode: modeSelect.value,
    featureEnabled: featureCheck.checked,
    loopLimit,
    loopCount: 0,
    trace: [],
  };

  return {
    state,
    mode: state.mode,
    featureEnabled: state.featureEnabled,
    confirmTarget: "confirm-template",
    yieldInput: () => ({
      question: "Apply scenario commit?",
      mode: state.mode,
      featureEnabled: state.featureEnabled,
      loopLimit: state.loopLimit,
      traceSoFar: state.trace.slice(),
    }),
    record: function (this: DemoState, message: string) {
      this.trace.push(`${this.trace.length + 1}. ${message}`);
      return message;
    },
    loopTick: function (this: DemoState) {
      this.loopCount += 1;
      const message = `loop:tick(${this.loopCount}/${this.loopLimit})`;
      this.trace.push(`${this.trace.length + 1}. ${message}`);
      return this.loopCount;
    },
    loopContinue: () => state.loopCount < state.loopLimit,
    finalize: () => ({
      status: "completed",
      mode: state.mode,
      featureEnabled: state.featureEnabled,
      loopCount: state.loopCount,
      trace: state.trace.slice(),
    }),
  };
};

const setRunning = (running: boolean) => {
  runButton.disabled = running;
  cancelButton.disabled = !running;
  if (!running) {
    resolveButton.disabled = true;
    rejectButton.disabled = true;
  }
};

const startScenario = async () => {
  if (activeHandle) return;

  resetView();
  setStatus("running");
  setRunning(true);
  appendLog("runtime modules: runner + fsm + dispatcher + registry + profile-dom-local");

  const prepared = prepare(buildFlow(), makeInitialContext(), { onStep: stepLogger });
  activeHandle = execute(prepared);

  try {
    const appContext = await activeHandle.done;
    const result = (appContext as Record<string | symbol, unknown>)[RETURN_VALUE];
    appendLog(`RETURN_VALUE=${formatValue(result)}`);
    setStatus("completed");
  } catch (error) {
    appendLog(`ERROR=${formatValue(error)}`);
    setStatus("failed");
  } finally {
    activeHandle = null;
    pendingYieldId = null;
    setPending("pending yield: none");
    setRunning(false);
  }
};

confirmTpl.addEventListener("fx-yield-start", (event: Event) => {
  const detail = (event as CustomEvent<PendingYieldDetail>).detail;
  pendingYieldId = detail.id;
  setPending(`pending yield: ${detail.id} exec=${detail.executionId} input=${formatValue(detail.input)}`);
  resolveButton.disabled = false;
  rejectButton.disabled = false;
  appendLog(`yield:start id=${detail.id}`);
});

runButton.addEventListener("click", () => {
  void startScenario();
});

cancelButton.addEventListener("click", () => {
  if (!activeHandle) return;
  activeHandle.cancel();
  appendLog("manual cancel requested");
});

resolveButton.addEventListener("click", () => {
  if (!pendingYieldId) return;
  confirmTpl.dispatchEvent(
    new CustomEvent("fx-yield-resolve", {
      detail: { id: pendingYieldId, value: "approve" },
      bubbles: true,
      composed: true,
    })
  );
  appendLog(`yield:resolve id=${pendingYieldId} value=approve`);
  pendingYieldId = null;
  resolveButton.disabled = true;
  rejectButton.disabled = true;
});

rejectButton.addEventListener("click", () => {
  if (!pendingYieldId) return;
  confirmTpl.dispatchEvent(
    new CustomEvent("fx-yield-reject", {
      detail: { id: pendingYieldId, error: new Error("rejected by demo user") },
      bubbles: true,
      composed: true,
    })
  );
  appendLog(`yield:reject id=${pendingYieldId}`);
  pendingYieldId = null;
  resolveButton.disabled = true;
  rejectButton.disabled = true;
});

resetView();
setStatus("idle");
