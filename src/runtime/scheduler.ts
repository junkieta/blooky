export type TickScheduler = {
  request: (cb: (t: number) => void) => void;
};

export const createRafScheduler = (): TickScheduler => {
  const request =
    globalThis.requestAnimationFrame ||
    ((f: (t: number) => void) =>
      setTimeout(() => f(performance.now()), Math.ceil(1000 / 60)));

  return {
    request: (cb) => {
      request(cb);
    },
  };
};

