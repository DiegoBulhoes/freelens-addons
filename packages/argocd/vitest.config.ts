import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/** `@freelensapp/extensions` only exists inside Electron; tests get the same classes from `test/freelens-host.ts`. */
export default defineConfig({
  resolve: {
    alias: {
      "@freelensapp/extensions": resolve(__dirname, "test/freelens-host.ts"),
    },
  },
  test: {
    // Real localStorage from jsdom, not a stub: tests rely on it throwing when unavailable.
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      include: ["src/renderer/api/**/*.ts"],
      // Store-access boundary: these only read stores or send patches; their decisions live in covered modules.
      exclude: [
        "src/renderer/api/types.ts",
        "src/renderer/api/cluster-health.ts",
        "src/renderer/api/workloads.ts",
        "src/renderer/api/actions.ts",
        "src/renderer/api/project-actions.ts",
        "src/renderer/api/image-updater-actions.ts",
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
