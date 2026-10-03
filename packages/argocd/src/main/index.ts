import { Main } from "@freelensapp/extensions";

/** All work happens in the renderer; this class only has to exist for the loader. */
export default class ArgoCDMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[argocd] main process extension activated");
  }
}
