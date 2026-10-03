import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

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
      // Pages and menus need a running Freelens: covered by verify-bundles.sh and e2e.
      include: ["src/renderer/api/**/*.ts"],
      exclude: [
        // Declarations only.
        "src/renderer/api/types.ts",
        // Registration over the host's KubeObject, which needs a running Freelens.
        "src/renderer/api/reports.ts",
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
