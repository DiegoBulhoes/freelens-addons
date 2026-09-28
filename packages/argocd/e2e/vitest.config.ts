import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Separate from this package's unit config on purpose. These need a running
 * Freelens with remote debugging on, they take tens of seconds, and they are not
 * part of `make check` — `make e2e` runs them.
 *
 * The harness they import lives in `build/e2e`, outside this package, so the
 * repository root has to be reachable: vite refuses to serve a file above its
 * root unless it is allowed.
 */
const repositoryRoot = resolve(__dirname, "../../..");

export default defineConfig({
  server: {
    fs: { allow: [repositoryRoot] },
  },
  test: {
    include: ["**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One window, one cluster: parallel files would fight over the same UI.
    fileParallelism: false,
  },
});
