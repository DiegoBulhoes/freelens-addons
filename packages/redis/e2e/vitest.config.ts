import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// The harness is in build/e2e, above this package, so vite must be allowed to serve it.
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
