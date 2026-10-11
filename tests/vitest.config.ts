import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['acceptance/**/*.test.ts'],
    // These suites spawn the real CLI binary, which loads SQLite and the full
    // engine — comfortably slower than a unit test, so give them room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each suite owns its own temp home/workspace/db, but they still contend for
    // CPU; run them serially so timing-based assertions stay stable.
    fileParallelism: false,
  },
});