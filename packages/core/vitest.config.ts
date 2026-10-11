import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts',
        // Pure type-declaration modules: they emit no runtime code, so counting
        // them as 0% coverage would misrepresent the suite.
        'src/types/**',
        'src/persistence/SessionStore.ts',
        'src/ports/fs.ts',
        'src/ports/search.ts',
        'src/ports/shell.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});