import { builtinModules, isBuiltin } from "node:module";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import { firstPartyOnly } from "./first-party-only";
import { globalExternals, MAIN_GLOBALS, RENDERER_GLOBALS } from "./global-externals";

const runtimeExternals = [
  "electron",
  /^electron\//,
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

// first-party-only allows builtins for both bundles; the renderer, loaded as ESM by URL, has none.
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

// `vite build` makes the renderer, `vite build --mode main` the main bundle.
export function defineExtensionConfig() {
  return defineConfig(({ mode }) => {
    if (mode === "main") {
      return {
        plugins: [globalExternals(MAIN_GLOBALS), firstPartyOnly()],
        // .mjs: an ES module without "type": "module", which would change every config and test file.
        build: esmLib("src/main/index.ts", "out/main", "index.mjs", runtimeExternals),
      };
    }

    return {
      plugins: [noNodeInRenderer(), globalExternals(RENDERER_GLOBALS), firstPartyOnly()],
      // .js: the host serves the renderer by extension, and .mjs can get the wrong MIME type.
      build: esmLib("src/renderer/index.tsx", "out/renderer", "index.js"),
    };
  });
}
