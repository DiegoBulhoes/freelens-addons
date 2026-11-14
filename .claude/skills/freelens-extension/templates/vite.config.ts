import { builtinModules, isBuiltin } from "node:module";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import { globalExternals, MAIN_GLOBALS, RENDERER_GLOBALS } from "./vite/global-externals";

// For a repository with no shared build config; otherwise re-export that one and delete `vite/`.
// `vite build` makes the renderer, `vite build --mode main` the main bundle.

const runtimeExternals = [
  "electron",
  /^electron\//,
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

// The renderer is loaded as an ES module by URL, with no Node to resolve a builtin.
function noNodeInRenderer(): Plugin {
  return {
    name: "freelens-no-node-in-renderer",
    enforce: "pre",
    resolveId(id) {
      if (isBuiltin(id) || id === "electron" || id.startsWith("electron/")) {
        this.error(`"${id}" is not available in the renderer; move this work to main over IPC`);
      }
      return null;
    },
  };
}

function esmLib(
  entry: string,
  outDir: string,
  fileName: string,
  external: (string | RegExp)[] = [],
): UserConfig["build"] {
  return {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    copyPublicDir: false,
    lib: {
      entry,
      formats: ["es"],
      fileName: () => fileName,
    },
    rollupOptions: {
      external,
      output: {
        // Freelens loads exactly one file per entrypoint.
        inlineDynamicImports: true,
      },
    },
  };
}

export default defineConfig(({ mode }) =>
  mode === "main"
    ? {
        plugins: [globalExternals(MAIN_GLOBALS)],
        build: esmLib("src/main/index.ts", "out/main", "index.mjs", runtimeExternals),
      }
    : {
        plugins: [noNodeInRenderer(), globalExternals(RENDERER_GLOBALS)],
        build: esmLib("src/renderer/index.tsx", "out/renderer", "index.js"),
      },
);
