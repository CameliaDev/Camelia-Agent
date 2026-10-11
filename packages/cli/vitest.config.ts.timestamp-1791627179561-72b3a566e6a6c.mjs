// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "file:///C:/Users/37963/Desktop/Camelia-Agent/node_modules/.pnpm/vitest@2.1.9_@types+node@22.20.5_jsdom@25.0.1_lightningcss@1.32.0/node_modules/vitest/dist/config.js";
var __vite_injected_original_import_meta_url = "file:///C:/Users/37963/Desktop/Camelia-Agent/packages/cli/vitest.config.ts";
var vitest_config_default = defineConfig({
  resolve: {
    alias: {
      "@camelia/core": fileURLToPath(new URL("../core/src/index.ts", __vite_injected_original_import_meta_url)),
      "@camelia/harness": fileURLToPath(new URL("../harness/src/index.ts", __vite_injected_original_import_meta_url)),
      "@camelia/agent/view": fileURLToPath(new URL("../agent/src/view/index.ts", __vite_injected_original_import_meta_url)),
      "@camelia/agent": fileURLToPath(new URL("../agent/src/index.ts", __vite_injected_original_import_meta_url))
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/bin.ts", "src/index.ts", "src/theme.ts"],
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXDM3OTYzXFxcXERlc2t0b3BcXFxcQ2FtZWxpYS1BZ2VudFxcXFxwYWNrYWdlc1xcXFxjbGlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXDM3OTYzXFxcXERlc2t0b3BcXFxcQ2FtZWxpYS1BZ2VudFxcXFxwYWNrYWdlc1xcXFxjbGlcXFxcdml0ZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvMzc5NjMvRGVza3RvcC9DYW1lbGlhLUFnZW50L3BhY2thZ2VzL2NsaS92aXRlc3QuY29uZmlnLnRzXCI7aW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGVzdC9jb25maWcnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAY2FtZWxpYS9jb3JlJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuLi9jb3JlL3NyYy9pbmRleC50cycsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgICAgJ0BjYW1lbGlhL2hhcm5lc3MnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4uL2hhcm5lc3Mvc3JjL2luZGV4LnRzJywgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgICAnQGNhbWVsaWEvYWdlbnQvdmlldyc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4vYWdlbnQvc3JjL3ZpZXcvaW5kZXgudHMnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgICdAY2FtZWxpYS9hZ2VudCc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4vYWdlbnQvc3JjL2luZGV4LnRzJywgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgfSxcbiAgfSxcbiAgdGVzdDoge1xuICAgIGVudmlyb25tZW50OiAnbm9kZScsXG4gICAgaW5jbHVkZTogWyd0ZXN0LyoqLyoudGVzdC50cyddLFxuICAgIGNvdmVyYWdlOiB7XG4gICAgICBwcm92aWRlcjogJ3Y4JyxcbiAgICAgIHJlcG9ydGVyOiBbJ3RleHQnLCAnanNvbi1zdW1tYXJ5JywgJ2xjb3YnXSxcbiAgICAgIGluY2x1ZGU6IFsnc3JjLyoqLyoudHMnXSxcbiAgICAgIGV4Y2x1ZGU6IFsnc3JjLyoqLyouZC50cycsICdzcmMvYmluLnRzJywgJ3NyYy9pbmRleC50cycsICdzcmMvdGhlbWUudHMnXSxcbiAgICAgIHRocmVzaG9sZHM6IHtcbiAgICAgICAgbGluZXM6IDgwLFxuICAgICAgICBmdW5jdGlvbnM6IDgwLFxuICAgICAgICBicmFuY2hlczogNzAsXG4gICAgICAgIHN0YXRlbWVudHM6IDgwLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUF1VixTQUFTLHFCQUFxQjtBQUNyWCxTQUFTLG9CQUFvQjtBQUQ0TCxJQUFNLDJDQUEyQztBQUcxUSxJQUFPLHdCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxpQkFBaUIsY0FBYyxJQUFJLElBQUksd0JBQXdCLHdDQUFlLENBQUM7QUFBQSxNQUMvRSxvQkFBb0IsY0FBYyxJQUFJLElBQUksMkJBQTJCLHdDQUFlLENBQUM7QUFBQSxNQUNyRix1QkFBdUIsY0FBYyxJQUFJLElBQUksOEJBQThCLHdDQUFlLENBQUM7QUFBQSxNQUMzRixrQkFBa0IsY0FBYyxJQUFJLElBQUkseUJBQXlCLHdDQUFlLENBQUM7QUFBQSxJQUNuRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE1BQU07QUFBQSxJQUNKLGFBQWE7QUFBQSxJQUNiLFNBQVMsQ0FBQyxtQkFBbUI7QUFBQSxJQUM3QixVQUFVO0FBQUEsTUFDUixVQUFVO0FBQUEsTUFDVixVQUFVLENBQUMsUUFBUSxnQkFBZ0IsTUFBTTtBQUFBLE1BQ3pDLFNBQVMsQ0FBQyxhQUFhO0FBQUEsTUFDdkIsU0FBUyxDQUFDLGlCQUFpQixjQUFjLGdCQUFnQixjQUFjO0FBQUEsTUFDdkUsWUFBWTtBQUFBLFFBQ1YsT0FBTztBQUFBLFFBQ1AsV0FBVztBQUFBLFFBQ1gsVUFBVTtBQUFBLFFBQ1YsWUFBWTtBQUFBLE1BQ2Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
