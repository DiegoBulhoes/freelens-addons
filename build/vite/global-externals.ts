import { createRequire } from "node:module";
import { join } from "node:path";
import type { Plugin } from "vite";

// The host provides these on globalThis.FreelensExtensionApi; a bundled React or MobX is a second
// instance and breaks hooks and observability.

const VIRTUAL_ID_PREFIX = "\0freelens-global:";
const API = "FreelensExtensionApi";
const EXTENSIONS = "@freelensapp/extensions";

export const MAIN_GLOBALS: Readonly<Record<string, string>> = {
  [EXTENSIONS]: API,
  mobx: "Mobx",
};

export const RENDERER_GLOBALS: Readonly<Record<string, string>> = {
  ...MAIN_GLOBALS,
  "mobx-react": "MobxReact",
  react: "React",
  "react-dom": "ReactDom",
  "react/jsx-runtime": "ReactJsxRuntime",
};

const HOST_PACKAGES = new Set(Object.keys(RENDERER_GLOBALS).map(packageNameOf));

const requireFromCwd = createRequire(join(process.cwd(), "__resolve__.cjs"));

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Valid object keys that cannot be re-exported as `export const <name>`.
const UNEXPORTABLE_NAMES = new Set([
  "default",
  "__esModule",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function packageNameOf(id: string): string {
  const parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? id);
}

// Read from the installed devDependency: the global exists only inside Freelens.
function exportNamesOf(id: string): string[] {
  try {
    return Object.keys(requireFromCwd(id)).filter(
      (n) => IDENTIFIER.test(n) && !UNEXPORTABLE_NAMES.has(n),
    );
  } catch {
    return [];
  }
}

function missing(what: string, moduleId: string): string {
  return JSON.stringify(
    `Freelens did not provide ${what}, needed for "${moduleId}". ` +
      `Is this bundle loaded in the process it was built for?`,
  );
}

// The published @freelensapp/extensions is this same read, and throws when required outside the host.
function apiShim(): string {
  return [
    `const __api = globalThis.${API};`,
    `if (__api === undefined) throw new Error(${missing(`globalThis.${API}`, EXTENSIONS)});`,
    `export const Common = __api.Common;`,
    `export const Main = __api.Main;`,
    `export const Renderer = __api.Renderer;`,
  ].join("\n");
}

function shimSource(moduleId: string, name: string, names: string[]): string {
  return [
    `const __m = globalThis.${API}?.${name};`,
    `if (__m === undefined) throw new Error(${missing(`${API}.${name}`, moduleId)});`,
    `export default __m;`,
    ...names.map((n) => `export const ${n} = __m.${n};`),
  ].join("\n");
}

export function globalExternals(globals: Readonly<Record<string, string>>): Plugin {
  const cache = new Map<string, string>();

  return {
    name: "freelens-global-externals",
    enforce: "pre",

    resolveId(id: string) {
      if (Object.hasOwn(globals, id)) {
        return { id: `${VIRTUAL_ID_PREFIX}${id}`, moduleSideEffects: false };
      }
      // Bundling it would be a second copy; the host publishes nothing else under these names.
      if (HOST_PACKAGES.has(packageNameOf(id))) {
        this.error(
          Object.hasOwn(RENDERER_GLOBALS, id)
            ? `"${id}" is provided to the renderer only; this bundle cannot import it`
            : `"${id}" is not provided by Freelens; import one of ${Object.keys(globals).join(", ")}`,
        );
      }
      return null;
    },

    load(id: string) {
      if (!id.startsWith(VIRTUAL_ID_PREFIX)) return null;

      const moduleId = id.slice(VIRTUAL_ID_PREFIX.length);
      let code = cache.get(moduleId);

      if (code === undefined) {
        code =
          moduleId === EXTENSIONS
            ? apiShim()
            : shimSource(moduleId, globals[moduleId] as string, exportNamesOf(moduleId));
        cache.set(moduleId, code);
      }

      return { code, moduleSideEffects: false };
    },
  };
}
