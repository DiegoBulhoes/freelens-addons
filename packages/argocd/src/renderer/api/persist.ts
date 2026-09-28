import { promises as fs } from "node:fs";
import { join } from "node:path";

import { clusterIdFromHost, stateFileName } from "./cluster-scope";
import { hydrate, onStateChange, snapshot } from "./local-state";

/**
 * Where an operator's pins are kept: one JSON file per cluster, in the
 * folder Freelens hands this extension. That is what the host does with its own
 * per-cluster UI state in `lens-local-storage/<clusterId>.json`, and it is the
 * only place the state survives a restart.
 *
 * Node is reachable here: the cluster frame runs with `nodeIntegration: true`,
 * `nodeIntegrationInSubFrames: true` and `contextIsolation: false`, and the
 * host's own renderer bundle requires `fs-extra`.
 */

interface FileFolderOwner {
  getExtensionFileFolder(): Promise<string>;
}

/**
 * The loader awaits every extension's `onActivate` inside one `Promise.all`
 * before it registers any page, so a hang here would stall every extension in
 * the frame, Freelens' own bundled ones included. A rejection it survives — it
 * logs and registers anyway — but a pending promise it does not. Hence a cap
 * rather than a bare await.
 */
const FOLDER_TIMEOUT_MS = 5_000;

let filePath: string | undefined;
let writes: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | undefined;

/**
 * Never rejects. Every way this can fail ends with the state in memory for the
 * life of the frame, which is exactly what the extension had before.
 */
export async function startPersistingState(
  extension: FileFolderOwner,
  host: string,
): Promise<void> {
  const fileName = stateFileName(clusterIdFromHost(host));

  // The root frame, where there is no cluster and no UI of ours to remember.
  if (fileName === undefined) return;

  const folder = await extensionFolderOrNothing(extension);

  if (folder === undefined) return;

  filePath = join(folder, fileName);

  // The folder name is a hash of a random salt, remembered in
  // lens-filesystem-provisioner-store.json. Say where it landed: a line in the
  // frame log beats losing every pin in silence if that mapping ever moves.
  console.log(`[argocd] operator state: ${filePath}`);

  try {
    hydrate(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    // No file on the first run, or one that cannot be read or parsed. Either
    // way the honest answer is no state, which is what an unhydrated store is.
  }

  unsubscribe = onStateChange(() => {
    writes = writes.then(writeSnapshot);
  });
}

/** Called from onDeactivate, so a pin set a moment earlier reaches the disk. */
export async function flushState(): Promise<void> {
  unsubscribe?.();
  unsubscribe = undefined;

  await writes;
}

async function extensionFolderOrNothing(extension: FileFolderOwner): Promise<string | undefined> {
  const timedOut = Symbol("timed out");

  try {
    const folder = await Promise.race([
      extension.getExtensionFileFolder(),
      new Promise<typeof timedOut>((resolve) =>
        setTimeout(() => resolve(timedOut), FOLDER_TIMEOUT_MS),
      ),
    ]);

    if (folder === timedOut) {
      console.error("[argocd] getExtensionFileFolder did not answer; pins stay in memory");

      return undefined;
    }

    return folder;
  } catch (error) {
    console.error("[argocd] no folder for operator state; pins stay in memory", error);

    return undefined;
  }
}

/**
 * Write-through rather than debounced: a pin is one click and the file is a few
 * kilobytes, so a debounce would only be a window in which a pin is lost. The
 * chain serialises writes, and temp-then-rename keeps a crash mid-write from
 * leaving a truncated file that would read back as no state at all.
 */
async function writeSnapshot(): Promise<void> {
  if (filePath === undefined) return;

  const temporary = `${filePath}.tmp`;

  try {
    await fs.writeFile(temporary, JSON.stringify(snapshot(), null, 2), "utf8");
    await fs.rename(temporary, filePath);
  } catch (error) {
    console.error(`[argocd] could not save operator state to ${filePath}`, error);
  }
}
