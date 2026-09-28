import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `@freelensapp/extensions` is not a module that can be imported outside
 * Electron — in the built extension it is rewritten to a host global, and here
 * it is rewritten to `test/freelens-host.ts`, which hands back the same classes
 * from the standalone packages. Same mechanism as production, pointed somewhere
 * a test process can reach. That is what lets the tests run against the real
 * `KubeObject` and `KubeApi` instead of a mock of them.
 */
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
      // The decision-making layer. Pages and hooks are excluded because reaching
      // them means standing up the host's component library and stores — the
      // mocks that would take are larger than the code they cover. Those are
      // verified by loading the extension into a real Freelens.
      include: ["src/renderer/api/**/*.ts"],
      exclude: [
        // Declarations only: no runtime code, and nought per cent says something
        // untrue about the tests.
        "src/renderer/api/types.ts",
        // Class declarations over the host's KubeObject: apiBase and crd metadata.
        // Registration the host performs, not a decision — every rule that reads
        // these kinds lives in a module that takes them as plain data and is
        // covered. The store hooks live in hooks/, outside this glob.
        "src/renderer/api/kinds.ts",
        // Sends the renewal patch and nothing else. Whether to offer it, what it
        // holds and what a refusal means are all in renewal.ts, which is covered.
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
