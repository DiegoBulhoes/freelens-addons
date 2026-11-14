import { Main } from "@freelensapp/extensions";

import { STATE_CHANNELS } from "../common/state-channels";
import { stateFiles } from "./state-file";

class ArgoCDIpc extends Main.Ipc {}

/** Serves the operator state file; everything else happens in the renderer. */
export default class ArgoCDMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    const files = stateFiles(() => this.getExtensionFileFolder());
    const ipc = ArgoCDIpc.createInstance(this);

    ipc.handle(STATE_CHANNELS.read, (_event, fileName: unknown) => files.read(fileName));
    ipc.handle(STATE_CHANNELS.write, (_event, fileName: unknown, text: unknown) =>
      files.write(fileName, text),
    );

    console.log("[argocd] main process extension activated");
  }
}
