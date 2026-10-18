import { promises as fs } from "node:fs";
import { join } from "node:path";

import { clusterIdFromHost, stateFileName } from "./cluster-scope";
import { hydrate, onStateChange, snapshot } from "./local-state";

// Not localStorage, which a new origin port wipes every launch. Node is reachable: the
// cluster frame runs with nodeIntegration and without context isolation.

interface FileFolderOwner {
  getExtensionFileFolder(): Promise<string>;
}

// Every extension's onActivate is awaited in one Promise.all: a hang here stalls them all.
const FOLDER_TIMEOUT_MS = 5_000;

let filePath: string | undefined;
let writes: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | undefined;

/** Never rejects; on failure the state stays in memory. */
export async function startPersistingState(
  extension: FileFolderOwner,
  host: string,
): Promise<void> {
  const fileName = stateFileName(clusterIdFromHost(host));

  // The root frame: no cluster, no UI of ours.
  if (fileName === undefined) return;

  const folder = await extensionFolderOrNothing(extension);

  if (folder === undefined) return;

  filePath = join(folder, fileName);

  // The folder name is a salted hash, so log where it landed.
  console.log(`[argocd] operator state: ${filePath}`);

  try {
    hydrate(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    // Missing or unreadable: start empty.
  }

  unsubscribe = onStateChange(() => {
    writes = writes.then(writeSnapshot);
  });
}

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

/** Writes are chained, and temp-then-rename keeps a crash from leaving a truncated file. */
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
