import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const isTest = process.env.VITEST === "true";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    // React Compiler: auto-memoization in app builds; disabled under Vitest so
    // coverage maps to source lines (the compiler's memo branches distort it).
    isTest
      ? react()
      : react({
          babel: {
            plugins: ["babel-plugin-react-compiler"],
          },
        }),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      // Backend origin is env-driven so Playwright E2E can run it on another
      // port (e.g. PAWPRINT_API_URL=http://127.0.0.1:8010) when 8000 is taken.
      "/api": { target: process.env.PAWPRINT_API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/media": { target: process.env.PAWPRINT_API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/ws": { target: (process.env.PAWPRINT_API_URL ?? "http://127.0.0.1:8000").replace(/^http/, "ws"), ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Playwright specs live in ./e2e and run via `npm run test:e2e`, not vitest.
    exclude: ["e2e/**", "test-results/**", "playwright-report/**", "**/node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        global: { lines: 70, functions: 70, branches: 60, statements: 70 },
      },
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
