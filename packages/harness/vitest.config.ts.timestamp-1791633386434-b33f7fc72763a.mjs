// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "file:///C:/Users/37963/Desktop/Camelia-Agent/node_modules/.pnpm/vitest@2.1.9_@types+node@22.20.5_jsdom@25.0.1_lightningcss@1.32.0/node_modules/vitest/dist/config.js";
var __vite_injected_original_import_meta_url = "file:///C:/Users/37963/Desktop/Camelia-Agent/packages/harness/vitest.config.ts";
var vitest_config_default = defineConfig({
  resolve: {
    alias: {
      "@camelia/core": fileURLToPath(new URL("../core/src/index.ts", __vite_injected_original_import_meta_url))
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/index.ts", "src/tools/types.ts", "src/context/RunContext.ts"],
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXDM3OTYzXFxcXERlc2t0b3BcXFxcQ2FtZWxpYS1BZ2VudFxcXFxwYWNrYWdlc1xcXFxoYXJuZXNzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFwzNzk2M1xcXFxEZXNrdG9wXFxcXENhbWVsaWEtQWdlbnRcXFxccGFja2FnZXNcXFxcaGFybmVzc1xcXFx2aXRlc3QuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy8zNzk2My9EZXNrdG9wL0NhbWVsaWEtQWdlbnQvcGFja2FnZXMvaGFybmVzcy92aXRlc3QuY29uZmlnLnRzXCI7aW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGVzdC9jb25maWcnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAY2FtZWxpYS9jb3JlJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuLi9jb3JlL3NyYy9pbmRleC50cycsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgIH0sXG4gIH0sXG4gIHRlc3Q6IHtcbiAgICBlbnZpcm9ubWVudDogJ25vZGUnLFxuICAgIGluY2x1ZGU6IFsndGVzdC8qKi8qLnRlc3QudHMnXSxcbiAgICBjb3ZlcmFnZToge1xuICAgICAgcHJvdmlkZXI6ICd2OCcsXG4gICAgICByZXBvcnRlcjogWyd0ZXh0JywgJ2pzb24tc3VtbWFyeScsICdsY292J10sXG4gICAgICBpbmNsdWRlOiBbJ3NyYy8qKi8qLnRzJ10sXG4gICAgICBleGNsdWRlOiBbJ3NyYy8qKi8qLmQudHMnLCAnc3JjL2luZGV4LnRzJywgJ3NyYy90b29scy90eXBlcy50cycsICdzcmMvY29udGV4dC9SdW5Db250ZXh0LnRzJ10sXG4gICAgICB0aHJlc2hvbGRzOiB7XG4gICAgICAgIGxpbmVzOiA4MCxcbiAgICAgICAgZnVuY3Rpb25zOiA4MCxcbiAgICAgICAgYnJhbmNoZXM6IDcwLFxuICAgICAgICBzdGF0ZW1lbnRzOiA4MCxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBbVcsU0FBUyxxQkFBcUI7QUFDalksU0FBUyxvQkFBb0I7QUFEb00sSUFBTSwyQ0FBMkM7QUFHbFIsSUFBTyx3QkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsaUJBQWlCLGNBQWMsSUFBSSxJQUFJLHdCQUF3Qix3Q0FBZSxDQUFDO0FBQUEsSUFDakY7QUFBQSxFQUNGO0FBQUEsRUFDQSxNQUFNO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixTQUFTLENBQUMsbUJBQW1CO0FBQUEsSUFDN0IsVUFBVTtBQUFBLE1BQ1IsVUFBVTtBQUFBLE1BQ1YsVUFBVSxDQUFDLFFBQVEsZ0JBQWdCLE1BQU07QUFBQSxNQUN6QyxTQUFTLENBQUMsYUFBYTtBQUFBLE1BQ3ZCLFNBQVMsQ0FBQyxpQkFBaUIsZ0JBQWdCLHNCQUFzQiwyQkFBMkI7QUFBQSxNQUM1RixZQUFZO0FBQUEsUUFDVixPQUFPO0FBQUEsUUFDUCxXQUFXO0FBQUEsUUFDWCxVQUFVO0FBQUEsUUFDVixZQUFZO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
