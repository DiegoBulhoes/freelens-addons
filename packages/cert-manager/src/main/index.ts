import { Main } from "@freelensapp/extensions";

// The log line is how `make up` confirms the bundle loaded.
export default class CertManagerMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[cert-manager] main process extension activated");
  }
}
