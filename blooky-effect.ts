// blooky-effect.ts
import type { Stream } from "./blooky";
import { drip } from "./blooky";

//
// 型定義
//

export type FxNode =
  | { type: "call", action: () => unknown }
  | { type: "sequence", steps: FxNode[] }
  | { type: "parallel", steps: FxNode[] }
  | { type: "delay", ms: number }
  | { type: "race", steps: FxNode[] }
  | { type: "condition", if: () => boolean, then: FxNode, else?: FxNode }
  | { type: "effect", stream: Stream<any>, value: any };

//
// DSL（ファクトリ）
//

export const fx = {
  call: (action: () => unknown): FxNode => ({ type: "call", action }),
  sequence: (steps: FxNode[]): FxNode => ({ type: "sequence", steps }),
  parallel: (steps: FxNode[]): FxNode => ({ type: "parallel", steps }),
  delay: (ms: number): FxNode => ({ type: "delay", ms }),
  race: (steps: FxNode[]): FxNode => ({ type: "race", steps }),
  condition: (
    cond: () => boolean,
    thenBranch: FxNode,
    elseBranch?: FxNode
  ): FxNode => ({
    type: "condition",
    if: cond,
    then: thenBranch,
    else: elseBranch,
  }),
  effect: <T>(stream: Stream<T>, value: T): FxNode => ({
    type: "effect",
    stream,
    value,
  }),
};

//
// 実行関数
//

export async function run(node: FxNode): Promise<void> {
  switch (node.type) {
    case "call":
      node.action();
      break;

    case "effect":
      drip(node.stream)(node.value); // Effect 実行
      break;

    case "delay":
      await new Promise((resolve) => setTimeout(resolve, node.ms));
      break;

    case "sequence":
      for (const step of node.steps) {
        await run(step);
      }
      break;

    case "parallel":
      await Promise.all(node.steps.map(run));
      break;

    case "race":
      await Promise.race(node.steps.map(run));
      break;

    case "condition":
      if (node.if()) {
        await run(node.then);
      } else if (node.else) {
        await run(node.else);
      }
      break;
  }
}

type CancelToken = { cancel: () => void; cancelled: () => boolean };

function createCancelToken(): CancelToken {
  let isCancelled = false;
  return {
    cancel: () => { isCancelled = true },
    cancelled: () => isCancelled
  };
}

export function runCancelable(node: FxNode): { promise: Promise<void>, cancel: () => void } {
  const token = createCancelToken();

  const promise = (async function run(n: FxNode): Promise<void> {
    if (token.cancelled()) return;

    switch (n.type) {
      case "call":
        n.action();
        break;

      case "effect":
        drip(n.stream)(n.value);
        break;

      case "delay":
        await new Promise((res) => {
          const timeout = setTimeout(res, n.ms);
          const check = () => token.cancelled() && clearTimeout(timeout);
          check();
        });
        break;

      case "sequence":
        for (const step of n.steps) {
          await run(step);
          if (token.cancelled()) return;
        }
        break;

      case "parallel":
        await Promise.all(n.steps.map((step) => run(step)));
        break;

      case "race":
        await Promise.race(n.steps.map((step) => run(step)));
        break;

      case "condition":
        const branch = n.if() ? n.then : n.else;
        if (branch) await run(branch);
        break;
    }
  })(node);

  return { promise, cancel: token.cancel };
}