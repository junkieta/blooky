import type { CancelToken } from "../blooky-fx-types";

/**
 * Error class for cancelled executions.
 */
export class Cancelled extends Error {
  readonly name = "Cancelled";
  constructor(readonly reason: string) {
    super(`Execution cancelled: ${reason}`);
  }
}

/**
 * Creates a cancel token that can be linked to a parent token.
 * When the parent is cancelled, this token is also considered cancelled.
 */
export function createChildCancelToken(parent?: CancelToken): CancelToken {
  let cancelled = false;
  let reason: any;
  return {
    parent,
    cancel: (r: any = "user") => {
      cancelled = true;
      reason = r;
    },
    cancelled: () => cancelled || !!parent?.cancelled(),
    get reason() {
      if (cancelled) return reason;
      return parent?.reason;
    },
  };
}
