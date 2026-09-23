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
  const listeners = new Set<(reason: any) => void>();
  const unsubscribeParent = parent?.onCancel((parentReason) => {
    cancelled = true;
    reason = parentReason;
    listeners.forEach((listener) => listener(parentReason));
  });
  return {
    parent,
    cancel: (r: any = "user") => {
      if (cancelled) return;
      cancelled = true;
      reason = r;
      listeners.forEach((listener) => listener(r));
    },
    cancelled: () => cancelled || !!parent?.cancelled(),
    get reason() {
      if (cancelled) return reason;
      return parent?.reason;
    },
    onCancel: (listener) => {
      if (cancelled || parent?.cancelled()) {
        listener(reason ?? parent?.reason ?? "user");
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
