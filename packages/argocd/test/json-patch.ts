import type { JsonPatchOperation } from "../src/renderer/api/image-updater-patches";

/** Applies a JSON patch (`test`, `replace`, `add`, `remove`) the way the API server does. */
export function applyPatch<T>(document: T, patch: JsonPatchOperation[]): T {
  const copy = JSON.parse(JSON.stringify(document)) as T;

  for (const operation of patch) {
    const keys = operation.path.split("/").slice(1);
    const last = keys.pop() as string;
    let parent = copy as unknown as Record<string, unknown>;

    for (const key of keys) parent = parent[key] as Record<string, unknown>;

    if (operation.op === "test") {
      if (JSON.stringify(parent[last]) !== JSON.stringify(operation.value)) {
        throw new Error(`test failed at ${operation.path}`);
      }
    } else if (operation.op === "remove") {
      delete parent[last];
    } else {
      parent[last] = JSON.parse(JSON.stringify(operation.value));
    }
  }

  return copy;
}
