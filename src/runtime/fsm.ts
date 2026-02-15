import type { SemanticEvent } from "./registry";

type Phase = "enter" | "running" | "suspended" | "completed" | "terminated";

export class RunnerFSM {
  private phase: Phase = "enter";
  private sawResult = false;
  private sawTerminate = false;

  onEnter() {
    if (this.phase !== "enter") throw new Error("FSM violation: enter twice");
    this.phase = "running";
  }

  onEvent(ev: SemanticEvent) {
    if (this.phase === "completed" || this.phase === "terminated") {
      throw new Error(`FSM violation: event after end (${ev.type})`);
    }

    switch (ev.type) {
      case "effect":
        if (this.sawResult || this.sawTerminate) {
          throw new Error("FSM violation: effect after result/terminate");
        }
        return;

      case "suspend":
        if (this.sawResult || this.sawTerminate) {
          throw new Error("FSM violation: suspend after result/terminate");
        }
        if (this.phase !== "running") {
          throw new Error("FSM violation: suspend when not running");
        }
        this.phase = "suspended";
        return;

      case "result":
        if (this.sawTerminate) throw new Error("FSM violation: result with terminate");
        if (this.sawResult) throw new Error("FSM violation: duplicate result");
        this.sawResult = true;
        this.phase = "completed";
        return;

      case "terminate":
        if (this.sawResult) throw new Error("FSM violation: terminate with result");
        if (this.sawTerminate) throw new Error("FSM violation: duplicate terminate");
        this.sawTerminate = true;
        this.phase = "terminated";
        return;
    }
  }

  onResume() {
    if (this.phase !== "suspended") throw new Error("FSM violation: resume without suspend");
    this.phase = "running";
  }
}
