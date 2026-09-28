import { Main } from "@freelensapp/extensions";

/**
 * Main-process half. The extension does its work in the renderer, talking to
 * the Kubernetes API through the host's own client, so there is nothing to do
 * here beyond existing — Freelens instantiates this class, and the log line is
 * how `make up` confirms the bundle loaded.
 */
export default class __Name__Main extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[__NAME__] main process extension activated");
  }
}
