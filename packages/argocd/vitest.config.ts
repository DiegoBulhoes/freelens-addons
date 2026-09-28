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
    // localStorage, for the modules that remember an operator's working state.
    // The real thing from jsdom, not a substitute: the behaviour that matters
    // is that it throws when storage is unavailable, and a hand-written stub
    // would only throw when told to.
    environment: "jsdom",
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
      // The store-access boundary. Each of these reads a Freelens store or
      // sends a patch and delegates every decision to a module that is
      // covered: cluster-health to pressure.ts, workloads to
      // workload-selection.ts, actions and project-actions to patches.ts.
      // Reaching them would mean standing up the host's stores, which is the
      // mocking this set of tests exists to avoid.
      exclude: [
        // Declarations only — no runtime code to execute, and counting it as
        // nought per cent says something untrue about the tests.
        "src/renderer/api/types.ts",
        "src/renderer/api/cluster-health.ts",
        "src/renderer/api/workloads.ts",
        "src/renderer/api/actions.ts",
        "src/renderer/api/project-actions.ts",
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
