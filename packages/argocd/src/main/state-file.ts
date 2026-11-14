import { promises as fs } from "node:fs";
import { join } from "node:path";

/** The operator state file, as main serves it to the cluster frame, which has no Node. */
export interface StateFiles {
  read(fileName: unknown): Promise<string | undefined>;
  write(fileName: unknown, text: unknown): Promise<void>;
}

// The name arrives over IPC: only a bare `<cluster id>.json` may reach the folder.
const STATE_FILE_NAME = /^[A-Za-z0-9_-]{1,64}\.json$/;

function checkedName(fileName: unknown): string {
  if (typeof fileName !== "string" || !STATE_FILE_NAME.test(fileName)) {
    throw new Error(`[argocd] refused operator state file name ${JSON.stringify(fileName)}`);
  }

  return fileName;
}

/** Rejects only when the folder or the request is unusable; a failed read or write is not fatal. */
export function stateFiles(folder: () => Promise<string>): StateFiles {
  return {
    async read(fileName) {
      const path = join(await folder(), checkedName(fileName));

      // The folder name is a salted hash, so log where it landed.
      console.log(`[argocd] operator state: ${path}`);

      try {
        return await fs.readFile(path, "utf8");
      } catch {
        // Missing or unreadable: start empty.
        return undefined;
      }
    },

    /** Temp-then-rename keeps a crash from leaving a truncated file. */
    async write(fileName, text) {
      const name = checkedName(fileName);

      if (typeof text !== "string") throw new Error("[argocd] operator state must be text");

      const path = join(await folder(), name);
      const temporary = `${path}.tmp`;

      try {
        await fs.writeFile(temporary, text, "utf8");
        await fs.rename(temporary, path);
      } catch (error) {
        console.error(`[argocd] could not save operator state to ${path}`, error);
      }
    },
  };
}
