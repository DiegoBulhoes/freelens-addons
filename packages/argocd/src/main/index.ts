import { Main } from "@freelensapp/extensions";

/**
 * Main-process half. The extension does all its work in the renderer, talking
 * to the Kubernetes API through the host's own client, so there is nothing to
 * do here beyond existing — Freelens instantiates this class and the log line
 * confirms the bundle loaded.
 */
export default class ArgoCDMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[argocd] main process extension activated");
  }
}
