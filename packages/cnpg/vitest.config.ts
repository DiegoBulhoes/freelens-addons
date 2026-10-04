import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// `@freelensapp/extensions` cannot load outside Electron; the real classes stand in, not a mock.
export default defineConfig({
  resolve: {
    alias: {
      "@freelensapp/extensions": resolve(__dirname, "test/freelens-host.ts"),
    },
  },
  test: {
    // "jsdom" instead, if a module under test reads localStorage.
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      // Decisions only; pages and hooks are checked in a real Freelens.
      include: ["src/renderer/api/**/*.ts"],
      exclude: [
        // Declarations only.
        "src/renderer/api/types.ts",
        // Registration only.
        "src/renderer/api/kinds.ts",
        // Sends the writes; operations.ts decides them.
        "src/renderer/api/actions.ts",
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
