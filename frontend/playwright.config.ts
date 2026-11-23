import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E — fully self-contained (no docker needed):
 *  - Django backend on 127.0.0.1:8010 with PAWPRINT_TESTING=1
 *    (locmem cache, in-memory channel layer, eager Celery, filesystem storage)
 *    against the local PostgreSQL on 127.0.0.1:5433
 *  - Vite dev server on 127.0.0.1:5173 proxying /api + /private-media to :8010
 *
 * Port 8010 is used because 8000 is commonly taken on dev machines.
 */
const API = "http://127.0.0.1:8010";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: ".venv/bin/python manage.py runserver 127.0.0.1:8010 --noreload",
      cwd: "../backend",
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PAWPRINT_TESTING: "1",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_DB: "pawprint",
        FRONTEND_BASE_URL: "http://127.0.0.1:5173",
      },
    },
    {
      command: "npm run dev -- --port 5173 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PAWPRINT_API_URL: API },
    },
  ],
});
