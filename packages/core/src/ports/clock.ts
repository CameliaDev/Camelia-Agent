/**
 * Clock port — injectable time, so retry/backoff and staleness checks are testable
 * without real delays.
 * @module
 */

export interface ClockPort {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: ClockPort = {
  now: () => Date.now(),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};