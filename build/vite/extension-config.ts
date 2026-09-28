import { builtinModules } from "node:module";
import { defineConfig } from "electron-vite";
import { globalExternals, MAIN_GLOBALS, RENDERER_GLOBALS } from "./global-externals";

/**
 * The electron-vite config every extension in this repo shares.
 *
 * Freelens' loader dictates the output shape: it `require`s exactly one file
 * per entrypoint and reads `.default` off it, expecting a constructor. ESM,
 * code splitting and rollup's default export handling each break that — all
 * three silently — so they are settled here once rather than re-derived per
 * package.
 */
export interface ExtensionConfigOptions {
  /** Main-process entry, relative to the package root. */
  mainEntry?: string;
  /** Renderer-process entry, relative to the package root. */
  rendererEntry?: string;
}

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

export function defineExtensionConfig(options: ExtensionConfigOptions = {}) {
  const { mainEntry = "src/main/index.ts", rendererEntry = "src/renderer/index.tsx" } = options;

  // Surfaced in the UI so a rebuild is observable without reading logs.
  const define = {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  };

  return defineConfig({
    main: {
      define,
      plugins: [globalExternals(MAIN_GLOBALS)],
      build: cjsLib(mainEntry, "out/main"),
    },

    // The renderer half is built through electron-vite's `preload` slot, not
    // its `renderer` slot. A renderer config is validated as a web app: it
    // looks for an index.html and refuses to build without one, which a
    // library has no reason to own. `preload` is already a CommonJS library
    // build, so it is the slot that fits. This mirrors what the upstream
    // freelens-example-extension does.
    preload: {
      define,
      plugins: [globalExternals(RENDERER_GLOBALS)],
      build: cjsLib(rendererEntry, "out/renderer"),
    },
  });
}
