import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `@freelensapp/extensions` is not a module that can be imported outside
 * Electron — in the built extension it is rewritten to a host global, and here
 * it is rewritten to `test/freelens-host.ts`, which hands back the same
 * classes from the standalone packages. Same mechanism as production, pointed
 * somewhere a test process can reach.
 */
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
      // The decision-making layer. The React pages and menus are excluded
      // because reaching them means standing up Freelens' component library,
      // its navigation and its stores — the mocks that would take are larger
      // than the code they cover and would assert that the mocks behave as
      // written. Those are verified by `verify-bundles.sh` and by running the
      // extension against a real cluster.
      include: ["src/renderer/api/**/*.ts"],
      exclude: [
        // Declarations only — no runtime code to execute, and counting it as
        // nought per cent says something untrue about the tests.
        "src/renderer/api/types.ts",
        // Class declarations over the host's KubeObject: apiBase, crd metadata
        // and the `report` field. The rules that read a report live in
        // coverage.ts, findings.ts and severity.ts and are covered; what is
        // left here is the registration the host performs, which needs a
        // running Freelens rather than a mock of one.
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
