import { defineConfig, devices } from "@playwright/test";
import { SITE_BASE } from "./src/config/site.mjs";

/**
 * E2E は本番と同じ base path（/study-mapf/）で確認する必要がある。
 * `astro preview` は astro.config.mjs の base をそのまま使うため、
 * baseURL に SITE_BASE を含めておけば page.goto("./") が正しく解決される。
 */
const PORT = 4321;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: `http://localhost:${PORT}${SITE_BASE}`,
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: {
    // build 済みの dist/ を配信する。dev サーバではなく本番相当で確認する。
    command: `npm run build:only && npx astro preview --port ${PORT}`,
    url: `http://localhost:${PORT}${SITE_BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
