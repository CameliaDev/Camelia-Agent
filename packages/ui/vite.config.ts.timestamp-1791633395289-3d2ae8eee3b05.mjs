// vite.config.ts
import react from "file:///C:/Users/37963/Desktop/Camelia-Agent/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@22.20.5_lightningcss@1.32.0_/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///C:/Users/37963/Desktop/Camelia-Agent/node_modules/.pnpm/@tailwindcss+vite@4.3.3_vite@5.4.21_@types+node@22.20.5_lightningcss@1.32.0_/node_modules/@tailwindcss/vite/dist/index.mjs";
import { defineConfig } from "file:///C:/Users/37963/Desktop/Camelia-Agent/node_modules/.pnpm/vitest@2.1.9_@types+node@22.20.5_jsdom@25.0.1_lightningcss@1.32.0/node_modules/vitest/dist/config.js";
var vite_config_default = defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Tauri loads `dist/` from the webview; keep the bundle self-contained.
    target: "es2022",
    sourcemap: true
  },
  server: {
    port: 5173,
    strictPort: true
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/vite-env.d.ts"]
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFwzNzk2M1xcXFxEZXNrdG9wXFxcXENhbWVsaWEtQWdlbnRcXFxccGFja2FnZXNcXFxcdWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXDM3OTYzXFxcXERlc2t0b3BcXFxcQ2FtZWxpYS1BZ2VudFxcXFxwYWNrYWdlc1xcXFx1aVxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvMzc5NjMvRGVza3RvcC9DYW1lbGlhLUFnZW50L3BhY2thZ2VzL3VpL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tICdAdGFpbHdpbmRjc3Mvdml0ZSc7XG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlc3QvY29uZmlnJztcblxuLyoqXG4gKiBPbmUgY29uZmlnIGZvciBib3RoIGB2aXRlIGJ1aWxkYCBhbmQgYHZpdGVzdCBydW5gLlxuICpcbiAqIFRoZSBVSSBpcyBhIHB1cmUgcHJvamVjdGlvbiBsYXllcjogaXQgaW1wb3J0cyBgQGNhbWVsaWEvYWdlbnQvdmlld2AgKGJyb3dzZXItc2FmZSlcbiAqIGFuZCBgQGNhbWVsaWEvY29yZWAgdHlwZXMgb25seS4gYEBjYW1lbGlhL2FnZW50YCdzIG1haW4gZW50cnkgaXMgbmV2ZXIgcmVmZXJlbmNlZFxuICogZnJvbSBoZXJlLCBzbyBubyBOb2RlLW9ubHkgY29kZSBjYW4gbGVhayBpbnRvIHRoZSBidW5kbGUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpLCB0YWlsd2luZGNzcygpXSxcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6ICdkaXN0JyxcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgICAvLyBUYXVyaSBsb2FkcyBgZGlzdC9gIGZyb20gdGhlIHdlYnZpZXc7IGtlZXAgdGhlIGJ1bmRsZSBzZWxmLWNvbnRhaW5lZC5cbiAgICB0YXJnZXQ6ICdlczIwMjInLFxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBzdHJpY3RQb3J0OiB0cnVlLFxuICB9LFxuICB0ZXN0OiB7XG4gICAgZW52aXJvbm1lbnQ6ICdqc2RvbScsXG4gICAgZ2xvYmFsczogdHJ1ZSxcbiAgICBzZXR1cEZpbGVzOiBbJy4vdGVzdC9zZXR1cC50cyddLFxuICAgIGluY2x1ZGU6IFsndGVzdC8qKi8qLnRlc3QudHMnLCAndGVzdC8qKi8qLnRlc3QudHN4J10sXG4gICAgY292ZXJhZ2U6IHtcbiAgICAgIHByb3ZpZGVyOiAndjgnLFxuICAgICAgcmVwb3J0ZXI6IFsndGV4dCcsICdqc29uLXN1bW1hcnknXSxcbiAgICAgIGluY2x1ZGU6IFsnc3JjLyoqLyoue3RzLHRzeH0nXSxcbiAgICAgIGV4Y2x1ZGU6IFsnc3JjL21haW4udHN4JywgJ3NyYy92aXRlLWVudi5kLnRzJ10sXG4gICAgfSxcbiAgfSxcbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBZ1YsT0FBTyxXQUFXO0FBQ2xXLE9BQU8saUJBQWlCO0FBQ3hCLFNBQVMsb0JBQW9CO0FBUzdCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLEdBQUcsWUFBWSxDQUFDO0FBQUEsRUFDaEMsT0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsYUFBYTtBQUFBO0FBQUEsSUFFYixRQUFRO0FBQUEsSUFDUixXQUFXO0FBQUEsRUFDYjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sWUFBWTtBQUFBLEVBQ2Q7QUFBQSxFQUNBLE1BQU07QUFBQSxJQUNKLGFBQWE7QUFBQSxJQUNiLFNBQVM7QUFBQSxJQUNULFlBQVksQ0FBQyxpQkFBaUI7QUFBQSxJQUM5QixTQUFTLENBQUMscUJBQXFCLG9CQUFvQjtBQUFBLElBQ25ELFVBQVU7QUFBQSxNQUNSLFVBQVU7QUFBQSxNQUNWLFVBQVUsQ0FBQyxRQUFRLGNBQWM7QUFBQSxNQUNqQyxTQUFTLENBQUMsbUJBQW1CO0FBQUEsTUFDN0IsU0FBUyxDQUFDLGdCQUFnQixtQkFBbUI7QUFBQSxJQUMvQztBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
