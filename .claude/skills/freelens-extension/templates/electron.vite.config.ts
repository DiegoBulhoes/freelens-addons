import { builtinModules } from "node:module";
import { defineConfig } from "electron-vite";
import { globalExternals, MAIN_GLOBALS, RENDERER_GLOBALS } from "./vite/global-externals";

/**
 * A standalone electron-vite config for one Freelens extension.
 *
 * If the repository already shares a build config between its extensions, do
 * not use this file: re-export that config the way the other packages do, and
 * delete `vite/` from this package. This exists for a repository that has none.
 *
 * Freelens' loader dictates the output shape: it `require`s exactly one file per
 * entrypoint and reads `.default` off it, expecting a constructor. ESM, code
 * splitting and rollup's default export handling each break that — all three
 * silently — so they are settled here.
 */

// Provided by the Node/Electron runtime inside Freelens. Bundling them would
// either fail or ship a second, inert copy.
const runtimeExternals = [
  "electron",
  /^electron\//,
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

function cjsLib(entry: string, outDir: string) {
  return {
    outDir,
    emptyOutDir: true,
    // Points a stack trace in the Freelens console back at the TypeScript source.
    sourcemap: true,
    // Readability beats size for an extension loaded off the local filesystem.
    minify: false,
    lib: {
      entry,
      formats: ["cjs" as const],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: runtimeExternals,
      output: {
        // One file per entrypoint: nothing may split out.
        inlineDynamicImports: true,
        // Freelens reads `require(entrypoint).default`. Rollup's "auto" mode
        // collapses a lone default export into `module.exports = Class`, which
        // leaves `.default` undefined — and an extension whose default export
        // is undefined is skipped without an error. "named" emits
        // `exports.default`.
        exports: "named" as const,
      },
    },
  };
}

export default defineConfig({
  main: {
    plugins: [globalExternals(MAIN_GLOBALS)],
    build: cjsLib("src/main/index.ts", "out/main"),
  },

  // The renderer half is built through electron-vite's `preload` slot, not its
  // `renderer` slot. A renderer config is validated as a web app: it looks for
  // an index.html and refuses to build without one, which a library has no
  // reason to own. `preload` is already a CommonJS library build, so it is the
  // slot that fits. This mirrors what freelens-example-extension does.
  preload: {
    plugins: [globalExternals(RENDERER_GLOBALS)],
    build: cjsLib("src/renderer/index.tsx", "out/renderer"),
  },
});
