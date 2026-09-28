import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hydrate, readState, writeState } from "../src/renderer/api/local-state";
import { flushState, startPersistingState } from "../src/renderer/api/persist";

/**
 * The real filesystem, in a real temporary directory. What this has to get
 * right is that state reaches the disk and comes back, and that every way the
 * folder lookup can fail still leaves a usable extension — the loader awaits
 * this inside one Promise.all covering every extension in the frame.
 */

const CLUSTER_HOST = "289e8b234825329f053f98f8d145e660.renderer.freelens.app:45555";
const CLUSTER_FILE = "289e8b234825329f053f98f8d145e660.json";

let folder: string;

/** An extension whose folder is a real directory, which is all persist.ts asks of it. */
function extensionWithFolder(path: string) {
  return { getExtensionFileFolder: async () => path };
}

beforeEach(async () => {
  folder = await fs.mkdtemp(join(tmpdir(), "argocd-persist-"));
  hydrate({});
});

afterEach(async () => {
  await flushState();
  await fs.rm(folder, { recursive: true, force: true });
});

describe("keeping an operator's state across a restart", () => {
  it("writes what was changed, under a file named after the cluster", async () => {
    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);

    writeState("freelens-addons.argocd.pins", ["argocd/guestbook"]);
    await flushState();

    const written = JSON.parse(await fs.readFile(join(folder, CLUSTER_FILE), "utf8"));

    expect(written).toEqual({
      "freelens-addons.argocd.pins": ["argocd/guestbook"],
    });
  });

  it("reads it back on the next activate, which is the whole point", async () => {
    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);
    writeState("freelens-addons.argocd.pins", ["argocd/helm-guestbook"]);
    await flushState();

    // The restart: the port in the host changes, everything in memory is gone.
    hydrate({});
    expect(readState("freelens-addons.argocd.pins", [])).toEqual([]);

    await startPersistingState(
      extensionWithFolder(folder),
      "289e8b234825329f053f98f8d145e660.renderer.freelens.app:33899",
    );

    expect(readState("freelens-addons.argocd.pins", [])).toEqual(["argocd/helm-guestbook"]);
  });

  it("gives two clusters two files, so a pin does not follow an Application across them", async () => {
    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);
    writeState("freelens-addons.argocd.pins", ["argocd/one"]);
    await flushState();

    await startPersistingState(
      extensionWithFolder(folder),
      "otherclusterid.renderer.freelens.app:1",
    );
    hydrate({});
    writeState("freelens-addons.argocd.pins", ["argocd/two"]);
    await flushState();

    expect((await fs.readdir(folder)).sort()).toEqual([CLUSTER_FILE, "otherclusterid.json"]);
  });

  it("leaves no temporary file behind, so a crash cannot be read back as no state", async () => {
    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);
    writeState("freelens-addons.argocd.preferences", { filter: "drift" });
    await flushState();

    expect(await fs.readdir(folder)).toEqual([CLUSTER_FILE]);
  });

  it("keeps both of two writes issued without waiting", async () => {
    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);

    writeState("freelens-addons.argocd.pins", ["argocd/one"]);
    writeState("freelens-addons.argocd.preferences", { filter: "mine" });
    await flushState();

    expect(JSON.parse(await fs.readFile(join(folder, CLUSTER_FILE), "utf8"))).toEqual({
      "freelens-addons.argocd.pins": ["argocd/one"],
      "freelens-addons.argocd.preferences": { filter: "mine" },
    });
  });
});

/**
 * These cases are indistinguishable from no persistence at all, which is the
 * point of them: every failure has to degrade to what the extension did before.
 * The suite above is what fails if persist.ts stops working.
 */
describe("starting up when the state cannot be reached", () => {
  it("survives a folder lookup that rejects, and still remembers within the session", async () => {
    const failing = {
      getExtensionFileFolder: async () => {
        throw new Error("no filesystem provisioner");
      },
    };

    await expect(startPersistingState(failing, CLUSTER_HOST)).resolves.toBeUndefined();

    writeState("freelens-addons.argocd.pins", ["argocd/one"]);
    expect(readState("freelens-addons.argocd.pins", [])).toEqual(["argocd/one"]);
  });

  it("gives up on a folder lookup that never answers rather than stalling the frame", async () => {
    vi.useFakeTimers();

    try {
      // A pending promise is the one failure the host's loader does not survive:
      // its Promise.all covers every extension in the frame, Freelens' own too.
      const starting = startPersistingState(
        { getExtensionFileFolder: () => new Promise<string>(() => {}) },
        CLUSTER_HOST,
      );

      await vi.advanceTimersByTimeAsync(5_000);

      await expect(starting).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a first run with no file as no state, not as a fault", async () => {
    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);

    expect(readState("freelens-addons.argocd.pins", [])).toEqual([]);
    expect(await fs.readdir(folder)).toEqual([]);
  });
});

describe("starting up against a file nobody should have written", () => {
  it("ignores a file that is not JSON at all", async () => {
    await fs.writeFile(join(folder, CLUSTER_FILE), "{ this is not json", "utf8");

    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);

    expect(readState("freelens-addons.argocd.pins", ["fallback"])).toEqual(["fallback"]);
  });

  it("ignores JSON that is not an object, rather than rendering against it", async () => {
    await fs.writeFile(join(folder, CLUSTER_FILE), '["a list, not a record"]', "utf8");

    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);

    expect(readState("freelens-addons.argocd.pins", ["fallback"])).toEqual(["fallback"]);
  });

  it("survives the folder disappearing under it, without losing the session", async () => {
    await startPersistingState(extensionWithFolder(folder), CLUSTER_HOST);
    await fs.rm(folder, { recursive: true, force: true });

    writeState("freelens-addons.argocd.pins", ["argocd/one"]);

    // A write that cannot land must not take the frame down with it, and the
    // operator keeps what they set for as long as the window is open.
    await expect(flushState()).resolves.toBeUndefined();
    expect(readState("freelens-addons.argocd.pins", [])).toEqual(["argocd/one"]);
  });

  it("writes nothing at all in the root frame, which shows no cluster", async () => {
    await startPersistingState(extensionWithFolder(folder), "renderer.freelens.app:45555");

    writeState("freelens-addons.argocd.pins", ["argocd/one"]);
    await flushState();

    expect(await fs.readdir(folder)).toEqual([]);
  });
});
