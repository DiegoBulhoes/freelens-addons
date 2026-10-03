import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Resolved to the real classes from the standalone packages, not a mock.
export default defineConfig({
  resolve: {
    alias: {
      "@freelensapp/extensions": resolve(__dirname, "test/freelens-host.ts"),
    },
  },
  test: {
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
        // Registration only; every rule reading these kinds is covered elsewhere.
        "src/renderer/api/kinds.ts",
        // Sends the patch; renewal.ts decides it.
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
