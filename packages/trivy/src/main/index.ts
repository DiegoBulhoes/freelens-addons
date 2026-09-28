import { Main } from "@freelensapp/extensions";

/**
 * Main-process half. The extension does all its work in the renderer, reading
 * the Trivy operator's reports through the host's own Kubernetes client, so
 * there is nothing to do here beyond existing.
 */
export default class TrivyMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[trivy] main process extension activated");
  }
}
