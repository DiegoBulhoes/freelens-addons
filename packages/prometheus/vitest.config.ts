import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Local-time code must not pass by being run in UTC; this zone has no daylight saving.
process.env.TZ = "America/Sao_Paulo";

// `@freelensapp/extensions` cannot load outside Electron; the real classes stand in, not a mock.
export default defineConfig({
  resolve: {
    alias: {
      "@freelensapp/extensions": resolve(__dirname, "test/support/freelens-host.ts"),
    },
  },
  test: {
    // "jsdom" instead, if a module under test reads localStorage.
    environment: "node",
    env: { TZ: "America/Sao_Paulo" },
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      // Decisions only; pages and hooks are checked in a real Freelens.
      include: ["src/renderer/api/**/*.ts"],
      exclude: [
        // Declarations only.
        "src/renderer/api/shared/types.ts",
        // Registration only.
        "src/renderer/api/shared/kinds.ts",
        // Cluster calls: Prometheus API and metrics reads, Events; parsed in prometheus-api, series, rejections.
        "src/renderer/api/shared/actions.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
