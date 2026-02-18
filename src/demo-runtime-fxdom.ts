import { RETURN_VALUE, prepare, execute } from "./blooky-fx";
import { fxdom, FxEffectElement } from "./blooky-fxdom";
import type { ExecutionHandle, ExecutionStep } from "./blooky-fx-types";
import { createFV } from "./blooky-fv";
import { stream, map, merge, hold, accum, drip, commit } from "./blooky-fp";
import { clock } from "./runtime/time";

const { prime, jshtml } = createFV(clock);

const runButton = document.getElementById("run") as HTMLButtonElement | null;
const cancelButton = document.getElementById("cancel") as HTMLButtonElement | null;
const resolveButton = document.getElementById("resolve") as HTMLButtonElement | null;
const rejectButton = document.getElementById("reject") as HTMLButtonElement | null;
const modeSelect = document.getElementById("mode") as HTMLSelectElement | null;
const featureCheck = document.getElementById("feature") as HTMLInputElement | null;
const loopLimitInput = document.getElementById("loopLimit") as HTMLInputElement | null;
const mountEl = document.getElementById("mount") as HTMLDivElement | null;
const statusEl = document.getElementById("status") as HTMLDivElement | null;
const pendingEl = document.getElementById("pending") as HTMLDivElement | null;
const summaryEl = document.getElementById("summary") as HTMLDivElement | null;
const logEl = document.getElementById("log") as HTMLDivElement | null;
const confirmTpl = document.getElementById("confirm-template") as HTMLTemplateElement | null;

if (
  !runButton ||
  !cancelButton ||
  !resolveButton ||
  !rejectButton ||
  !modeSelect ||
  !featureCheck ||
  !loopLimitInput ||
  !mountEl ||
  !statusEl ||
  !pendingEl ||
  !summaryEl ||
  !logEl ||
  !confirmTpl
) {
  throw new Error("runtime score-fx fxdom demo: required elements are missing");
}

type DemoModel = {
  $startedAt: () => string;
  $mode: () => string;
  $featureEnabled: () => boolean;
  $loopLimit: () => number;
  $loopCount: () => number;
  $trace: () => string[];
  record: (message: string) => string;
  loopTick: () => number;
  loopContinue: () => boolean;
  yieldInput: () => Record<string, unknown>;
  finalize: () => Record<string, unknown>;
};

type PendingYieldDetail = { id: string; executionId: string; input?: unknown };

let activeHandle: ExecutionHandle | null = null;
let pendingYieldId: string | null = null;
let stepCount = 0;
const phaseCounter = new Map<string, number>();
const noteCounter = new Map<string, number>();
const laneColorByExecutionId = new Map<string, string>();
const lanePalette = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899"];

if (!customElements.get("fx-effect")) {
  fxdom.defineEffectElements();
}

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

const laneColor = (executionId: string): string => {
  if (!laneColorByExecutionId.has(executionId)) {
    let hash = 0;
    for (const ch of executionId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    laneColorByExecutionId.set(executionId, lanePalette[hash % lanePalette.length]);
  }
  return laneColorByExecutionId.get(executionId)!;
};

const appendLog = (
  line: string,
  options?: { executionId?: string; raceTag?: "winner" | "loser"; info?: boolean }
) => {
  const row = document.createElement("div");
  row.className = `log-line${options?.info ? " info" : ""}`;

  if (options?.executionId && options.executionId !== "-") {
    row.style.borderLeftColor = laneColor(options.executionId);
    const lanePill = document.createElement("span");
    lanePill.className = "pill exec";
    lanePill.textContent = options.executionId;
    row.appendChild(lanePill);
  }

  if (options?.raceTag) {
    row.classList.add(`race-${options.raceTag}`);
    const racePill = document.createElement("span");
    racePill.className = `pill race-${options.raceTag}`;
    racePill.textContent = options.raceTag;
    row.appendChild(racePill);
  }

  const text = document.createElement("span");
  text.textContent = line;
  row.appendChild(text);
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
};

const renderSummary = () => {
  const phaseText = [...phaseCounter.entries()].map(([k, v]) => `${k}:${v}`).join("  ");
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
  logEl.replaceChildren();
  stepCount = 0;
  phaseCounter.clear();
  noteCounter.clear();
  laneColorByExecutionId.clear();
  pendingYieldId = null;
  setPending("pending yield: none");
  renderSummary();
};

const detectRaceTag = (step: ExecutionStep): "winner" | "loser" | undefined => {
  const noteId = step.note.id ?? "";
  if (!noteId.startsWith("race")) return undefined;
  if (step.phase === "cancel") return "loser";
  if ((noteId === "raceFast" || noteId === "raceFastCall") && (step.phase === "result" || step.phase === "exit")) {
    return "winner";
  }
  return undefined;
};

const stepLogger = (step: ExecutionStep) => {
  stepCount += 1;
  addCount(phaseCounter, step.phase);
  addCount(noteCounter, step.note.type);
  renderSummary();

  const executionId = typeof step.data?.executionId === "string" ? step.data.executionId : "-";
  const noteId = step.note.id ? `#${step.note.id}` : "-";
  appendLog(
    `${String(stepCount).padStart(3, "0")}  phase=${step.phase.padEnd(9, " ")} note=${step.note.type.padEnd(9, " ")} id=${noteId.padEnd(16, " ")} data=${formatValue(step.data)}`,
    {
      executionId,
      raceTag: detectRaceTag(step),
    }
  );
};

type FxFlowContext = Record<string, unknown> & {
  record: (message: string) => string;
  loopTick: () => number;
  loopContinue: () => boolean;
  finalize: () => Record<string, unknown>;
  mode: string;
  featureEnabled: boolean;
  confirmTarget: string;
  yieldInput: () => Record<string, unknown>;
  sequenceStartMessage: string;
  parallelAMessage: string;
  parallelBMessage: string;
  raceFastMessage: string;
  raceSlowAMessage: string;
  raceSlowBMessage: string;
  conditionTrueMessage: string;
  conditionFalseMessage: string;
  switchSafeMessage: string;
  switchFastMessage: string;
  switchDefaultMessage: string;
  yieldApproveMessage: string;
  yieldRejectMessage: string;
  yieldUnknownMessage: string;
};

const FxFlow = prime((ctx: FxFlowContext) => ({
  "fx-effect": [
    { "fx-call": jshtml.$({ fn: ctx.record, arg: ctx.sequenceStartMessage, id: "startCall" }) },
    {
      "fx-parallel": [
        {
          "fx-sequence": [
            { "fx-wait": jshtml.$({ ms: 80 }) },
            { "fx-call": jshtml.$({ fn: ctx.record, arg: ctx.parallelAMessage, id: "parallelA" }) },
          ],
          $: { id: "parallelBranchA" },
        },
        {
          "fx-sequence": [
            { "fx-wait": jshtml.$({ ms: 180 }) },
            { "fx-call": jshtml.$({ fn: ctx.record, arg: ctx.parallelBMessage, id: "parallelB" }) },
          ],
          $: { id: "parallelBranchB" },
        },
      ],
      $: { id: "parallelBlock" },
    },
    {
      "fx-race": [
        {
          "fx-sequence": [
            { "fx-wait": jshtml.$({ ms: 360 }) },
            { "fx-call": jshtml.$({ fn: ctx.record, arg: ctx.raceSlowAMessage, id: "raceSlowACall" }) },
          ],
          $: { id: "raceSlowA" },
        },
        {
          "fx-sequence": [
            { "fx-wait": jshtml.$({ ms: 120 }) },
            { "fx-call": jshtml.$({ fn: ctx.record, arg: ctx.raceFastMessage, id: "raceFastCall" }) },
          ],
          $: { id: "raceFast" },
        },
        {
          "fx-sequence": [
            { "fx-wait": jshtml.$({ ms: 260 }) },
            { "fx-call": jshtml.$({ fn: ctx.record, arg: ctx.raceSlowBMessage, id: "raceSlowBCall" }) },
          ],
          $: { id: "raceSlowB" },
        },
      ],
      $: { id: "raceBlock" },
    },
    {
      "fx-if": [
        { "fx-call": jshtml.$({ slot: "then", fn: ctx.record, arg: ctx.conditionTrueMessage, id: "condTrue" }) },
        { "fx-call": jshtml.$({ slot: "else", fn: ctx.record, arg: ctx.conditionFalseMessage, id: "condFalse" }) },
      ],
      $: { when: ctx.featureEnabled, id: "conditionBlock" },
    },
    {
      "fx-switch": [
        { "fx-call": jshtml.$({ slot: "safe", fn: ctx.record, arg: ctx.switchSafeMessage, id: "modeSafe" }) },
        { "fx-call": jshtml.$({ slot: "fast", fn: ctx.record, arg: ctx.switchFastMessage, id: "modeFast" }) },
        { "fx-call": jshtml.$({ slot: "default", fn: ctx.record, arg: ctx.switchDefaultMessage, id: "modeDefault" }) },
      ],
      $: { by: ctx.mode, id: "switchBlock" },
    },
    {
      "fx-loop": [
        {
          "fx-sequence": [
            { "fx-call": jshtml.$({ fn: ctx.loopTick, id: "loopTickCall" }) },
            { "fx-wait": jshtml.$({ ms: 60 }) },
          ],
          $: { id: "loopBody" },
        },
      ],
      $: { while: ctx.loopContinue, "max-iterations": 8, id: "loopBlock" },
    },
    { "fx-yield": jshtml.$({ for: ctx.confirmTarget, value: ctx.yieldInput, id: "confirm" }) },
    {
      "fx-switch": [
        { "fx-call": jshtml.$({ slot: "approve", fn: ctx.record, arg: ctx.yieldApproveMessage, id: "yieldApproved" }) },
        { "fx-call": jshtml.$({ slot: "reject", fn: ctx.record, arg: ctx.yieldRejectMessage, id: "yieldRejected" }) },
        { "fx-call": jshtml.$({ slot: "default", fn: ctx.record, arg: ctx.yieldUnknownMessage, id: "yieldUnknown" }) },
      ],
      $: { by: "#confirm", id: "yieldSwitch" },
    },
    { "fx-return": jshtml.$({ value: ctx.finalize, id: "finalReturn" }) },
  ],
  $: { id: "root" },
}));

const buildFlowElement = (ctx: FxFlowContext): FxEffectElement => FxFlow(ctx) as FxEffectElement;

const createDemoModel = (): DemoModel => {
  const startedAt = new Date().toISOString();
  const mode = modeSelect.value;
  const featureEnabled = featureCheck.checked;
  const loopLimit = Math.max(1, Math.min(8, Number(loopLimitInput.value) || 3));

  const source = {
    mode$: stream<string>(),
    featureEnabled$: stream<boolean>(),
    loopLimit$: stream<number>(),
    startedAt$: stream<string>(),
    record$: stream<string>(),
    loopTick$: stream<null>(),
  };

  const $mode = hold(mode)(source.mode$);
  const $featureEnabled = hold(featureEnabled)(source.featureEnabled$);
  const $loopLimit = hold(loopLimit)(source.loopLimit$);
  const $startedAt = hold(startedAt)(source.startedAt$);
  const $loopCount = accum((count: number) => count + 1, 0)(source.loopTick$);

  const traceRecord$ = map((message: string) => message)(source.record$);
  const traceLoop$ = map(() => `loop:tick(${$loopCount() + 1}/${$loopLimit()})`)(source.loopTick$);
  const traceMessage$ = merge([traceRecord$, traceLoop$]);
  const $trace = accum((trace: string[], message: string) => [...trace, `${trace.length + 1}. ${message}`], [])(traceMessage$);

  const record = (message: string) => {
    commit(drip(message)(source.record$));
    return message;
  };

  const loopTick = () => {
    const nextCount = $loopCount() + 1;
    commit(drip(null)(source.loopTick$));
    return nextCount;
  };

  const loopContinue = () => $loopCount() < $loopLimit();

  const yieldInput = () => ({
    question: "Apply scenario commit?",
    mode: $mode(),
    featureEnabled: $featureEnabled(),
    loopLimit: $loopLimit(),
    traceSoFar: $trace().slice(),
  });

  const finalize = () => ({
    status: "completed",
    startedAt: $startedAt(),
    mode: $mode(),
    featureEnabled: $featureEnabled(),
    loopCount: $loopCount(),
    trace: $trace().slice(),
  });

  return {
    $startedAt,
    $mode,
    $featureEnabled,
    $loopLimit,
    $loopCount,
    $trace,
    record,
    loopTick,
    loopContinue,
    yieldInput,
    finalize,
  };
};

const makeInitialContext = (): FxFlowContext => {
  const model = createDemoModel();

  return {
    mode: model.$mode(),
    featureEnabled: model.$featureEnabled(),
    confirmTarget: "confirm-template",
    yieldInput: model.yieldInput,
    record: model.record,
    loopTick: model.loopTick,
    loopContinue: model.loopContinue,
    finalize: model.finalize,

    sequenceStartMessage: "sequence:start",
    parallelAMessage: "parallel:A",
    parallelBMessage: "parallel:B",
    raceFastMessage: "race:fast winner",
    raceSlowAMessage: "race:slowA",
    raceSlowBMessage: "race:slowB",
    conditionTrueMessage: "condition:true",
    conditionFalseMessage: "condition:false",
    switchSafeMessage: "switch:safe",
    switchFastMessage: "switch:fast",
    switchDefaultMessage: "switch:default",
    yieldApproveMessage: "yield:approve",
    yieldRejectMessage: "yield:reject",
    yieldUnknownMessage: "yield:unknown",
  } as FxFlowContext;
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
  appendLog("runtime modules: runner + fsm + dispatcher + registry + profile-dom-local", { info: true });

  const context = makeInitialContext();
  const fxEffect = buildFlowElement(context);
  mountEl.replaceChildren(fxEffect);

  const prepared = prepare(fxEffect.toFxNote(), context, { onStep: stepLogger });
  activeHandle = execute(prepared);

  try {
    const appContext = await activeHandle.done;
    const result = (appContext as Record<string | symbol, unknown>)[RETURN_VALUE];
    appendLog(`RETURN_VALUE=${formatValue(result)}`, { info: true });
    setStatus("completed");
  } catch (error) {
    appendLog(`ERROR=${formatValue(error)}`, { info: true });
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
  appendLog(`yield:start id=${detail.id}`, { executionId: detail.executionId, info: true });
});

runButton.addEventListener("click", () => {
  void startScenario();
});

cancelButton.addEventListener("click", () => {
  if (!activeHandle) return;
  activeHandle.cancel();
  appendLog("manual cancel requested", { info: true });
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
  appendLog(`yield:resolve id=${pendingYieldId} value=approve`, { info: true });
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
  appendLog(`yield:reject id=${pendingYieldId}`, { info: true });
  pendingYieldId = null;
  resolveButton.disabled = true;
  rejectButton.disabled = true;
});

resetView();
setStatus("idle");
