// src/runtime/internal/observer-bus.ts
//
// Generic observer pattern for isolated pub/sub.
// Used by clock.ts and runtime step observation.

export function createObserverBus<T>() {
  const observers = new Set<(value: T) => void | Promise<void>>();

  const observe = (
    observer: (value: T) => void | Promise<void>
  ): (() => void) => {
    observers.add(observer);
    return () => {
      observers.delete(observer);
    };
  };

  const emit = (value: T): void => {
    if (!observers.size) return;
    observers.forEach((observer) => {
      try {
        const maybePromise = observer(value);
        if (
          maybePromise &&
          typeof (maybePromise as any).then === "function" &&
          typeof (maybePromise as any).catch === "function"
        ) {
          (maybePromise as Promise<unknown>).catch((e) => {
            console.error("[observer-bus] async error (isolated)", e);
          });
        }
      } catch (e) {
        console.error("[observer-bus] error (isolated)", e);
      }
    });
  };

  return { observe, emit };
}
