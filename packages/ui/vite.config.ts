import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

/**
 * One config for both `vite build` and `vitest run`.
 *
 * The UI is a pure projection layer: it imports `@camelia/agent/view` (browser-safe)
 * and `@camelia/core` types only. `@camelia/agent`'s main entry is never referenced
 * from here, so no Node-only code can leak into the bundle.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Tauri loads `dist/` from the webview; keep the bundle self-contained.
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Windows locks font files while the browser has them open; watching them
    // crashes the dev server (EBUSY). The build still bundles the files.
    watch: {
      ignored: ['**/*.woff2', '**/*.txt'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});