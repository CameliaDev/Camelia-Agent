import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@camelia/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@camelia/harness': fileURLToPath(new URL('../harness/src/index.ts', import.meta.url)),
      '@camelia/agent/view': fileURLToPath(new URL('../agent/src/view/index.ts', import.meta.url)),
      '@camelia/agent': fileURLToPath(new URL('../agent/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/bin.ts', 'src/index.ts', 'src/theme.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});