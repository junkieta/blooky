import { fx, prepare, execute, ref, RETURN_VALUE } from "./blooky-fx";
import type { ExecutionStep } from "./blooky-fx-types";

const runButton = document.getElementById("run") as HTMLButtonElement;
const resolveButton = document.getElementById("resolve") as HTMLButtonElement;
const rejectButton = document.getElementById("reject") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const pendingEl = document.getElementById("pending") as HTMLDivElement;
const outputEl = document.getElementById("output") as HTMLPreElement;
const stepsEl = document.getElementById("steps") as HTMLDivElement;
const confirmTpl = document.getElementById("confirm-template") as HTMLTemplateElement;
const questionEl = document.getElementById("question") as HTMLDivElement;
const executionEl = document.getElementById("execution") as HTMLDivElement;

let pendingYieldId: string | null = null;

const addStep = (step: ExecutionStep) => {
  const line = document.createElement("div");
  const noteId = step.note.id ? `#${step.note.id}` : "-";
  line.textContent = `${new Date().toLocaleTimeString()}  ${step.phase}  note=${step.note.type}  id=${noteId}`;
  stepsEl.appendChild(line);
  stepsEl.scrollTop = stepsEl.scrollHeight;
};

const setStatus = (text: string) => {
  statusEl.textContent = text;
};

const setPending = (text: string) => {
  pendingEl.textContent = text;
};

const clearLog = () => {
  stepsEl.replaceChildren();
  outputEl.textContent = "";
  questionEl.textContent = "-";
  executionEl.textContent = "-";
  pendingYieldId = null;
  resolveButton.disabled = true;
  rejectButton.disabled = true;
  setPending("pending: none");
};

confirmTpl.addEventListener("fx-yield-start", (event: Event) => {
  const detail = (event as CustomEvent<{ id: string; input?: unknown; executionId: string }>).detail;
  pendingYieldId = detail.id;
  questionEl.textContent = JSON.stringify(detail.input ?? null);
  executionEl.textContent = detail.executionId;
  setPending(`pending: ${detail.id}`);
  setStatus("suspended (waiting for resolve/reject)");
  resolveButton.disabled = false;
  rejectButton.disabled = false;
});

const flow = fx.sequence(
  [
    fx.yield({
      for: ref("confirm-template"),
      value: () => ({ prompt: "apply update?", at: new Date().toISOString() }),
      id: "confirm",
    }),
    fx.return(ref("#confirm"), "final-return"),
  ],
  "root"
);

const runDemo = async () => {
  clearLog();
  setStatus("running");

  const prepared = prepare(flow, {}, { onStep: addStep });

  try {
    const handle = execute(prepared);
    const context = await handle.done;
    const returnValue = (context as Record<string | symbol, unknown>)[RETURN_VALUE];
    outputEl.textContent = JSON.stringify(
      {
        returnValue,
        yieldResult: (context as Record<string, unknown>)["#confirm"],
      },
      null,
      2
    );
    setStatus("completed");
  } catch (error) {
    outputEl.textContent = String(error);
    setStatus("failed");
  } finally {
    resolveButton.disabled = true;
    rejectButton.disabled = true;
    pendingYieldId = null;
    setPending("pending: none");
  }
};

runButton.addEventListener("click", () => {
  void runDemo();
});

resolveButton.addEventListener("click", () => {
  if (!pendingYieldId) return;
  confirmTpl.dispatchEvent(
    new CustomEvent("fx-yield-resolve", {
      detail: { id: pendingYieldId, value: { decision: "yes", from: "local-demo" } },
      bubbles: true,
      composed: true,
    })
  );
});

rejectButton.addEventListener("click", () => {
  if (!pendingYieldId) return;
  confirmTpl.dispatchEvent(
    new CustomEvent("fx-yield-reject", {
      detail: { id: pendingYieldId, error: new Error("rejected in local demo") },
      bubbles: true,
      composed: true,
    })
  );
});

clearLog();
