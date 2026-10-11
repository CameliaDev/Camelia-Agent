// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "file:///C:/Users/37963/Desktop/Camelia-Agent/node_modules/.pnpm/vitest@2.1.9_@types+node@22.20.5_jsdom@25.0.1_lightningcss@1.32.0/node_modules/vitest/dist/config.js";
var __vite_injected_original_import_meta_url = "file:///C:/Users/37963/Desktop/Camelia-Agent/packages/agent/vitest.config.ts";
var vitest_config_default = defineConfig({
  resolve: {
    alias: {
      "@camelia/core": fileURLToPath(new URL("../core/src/index.ts", __vite_injected_original_import_meta_url)),
      "@camelia/harness": fileURLToPath(new URL("../harness/src/index.ts", __vite_injected_original_import_meta_url))
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/index.ts", "src/bin.ts", "src/adapters/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80
      }
    }
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXDM3OTYzXFxcXERlc2t0b3BcXFxcQ2FtZWxpYS1BZ2VudFxcXFxwYWNrYWdlc1xcXFxhZ2VudFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcMzc5NjNcXFxcRGVza3RvcFxcXFxDYW1lbGlhLUFnZW50XFxcXHBhY2thZ2VzXFxcXGFnZW50XFxcXHZpdGVzdC5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzLzM3OTYzL0Rlc2t0b3AvQ2FtZWxpYS1BZ2VudC9wYWNrYWdlcy9hZ2VudC92aXRlc3QuY29uZmlnLnRzXCI7aW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGVzdC9jb25maWcnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAY2FtZWxpYS9jb3JlJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuLi9jb3JlL3NyYy9pbmRleC50cycsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgICAgJ0BjYW1lbGlhL2hhcm5lc3MnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4uL2hhcm5lc3Mvc3JjL2luZGV4LnRzJywgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgfSxcbiAgfSxcbiAgdGVzdDoge1xuICAgIGVudmlyb25tZW50OiAnbm9kZScsXG4gICAgaW5jbHVkZTogWyd0ZXN0LyoqLyoudGVzdC50cyddLFxuICAgIGNvdmVyYWdlOiB7XG4gICAgICBwcm92aWRlcjogJ3Y4JyxcbiAgICAgIHJlcG9ydGVyOiBbJ3RleHQnLCAnanNvbi1zdW1tYXJ5JywgJ2xjb3YnXSxcbiAgICAgIGluY2x1ZGU6IFsnc3JjLyoqLyoudHMnXSxcbiAgICAgIGV4Y2x1ZGU6IFsnc3JjLyoqLyouZC50cycsICdzcmMvaW5kZXgudHMnLCAnc3JjL2Jpbi50cycsICdzcmMvYWRhcHRlcnMvKionXSxcbiAgICAgIHRocmVzaG9sZHM6IHtcbiAgICAgICAgbGluZXM6IDgwLFxuICAgICAgICBmdW5jdGlvbnM6IDgwLFxuICAgICAgICBicmFuY2hlczogNzAsXG4gICAgICAgIHN0YXRlbWVudHM6IDgwLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUE2VixTQUFTLHFCQUFxQjtBQUMzWCxTQUFTLG9CQUFvQjtBQURnTSxJQUFNLDJDQUEyQztBQUc5USxJQUFPLHdCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxpQkFBaUIsY0FBYyxJQUFJLElBQUksd0JBQXdCLHdDQUFlLENBQUM7QUFBQSxNQUMvRSxvQkFBb0IsY0FBYyxJQUFJLElBQUksMkJBQTJCLHdDQUFlLENBQUM7QUFBQSxJQUN2RjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE1BQU07QUFBQSxJQUNKLGFBQWE7QUFBQSxJQUNiLFNBQVMsQ0FBQyxtQkFBbUI7QUFBQSxJQUM3QixVQUFVO0FBQUEsTUFDUixVQUFVO0FBQUEsTUFDVixVQUFVLENBQUMsUUFBUSxnQkFBZ0IsTUFBTTtBQUFBLE1BQ3pDLFNBQVMsQ0FBQyxhQUFhO0FBQUEsTUFDdkIsU0FBUyxDQUFDLGlCQUFpQixnQkFBZ0IsY0FBYyxpQkFBaUI7QUFBQSxNQUMxRSxZQUFZO0FBQUEsUUFDVixPQUFPO0FBQUEsUUFDUCxXQUFXO0FBQUEsUUFDWCxVQUFVO0FBQUEsUUFDVixZQUFZO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
