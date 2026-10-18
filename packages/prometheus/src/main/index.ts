import { Main } from "@freelensapp/extensions";

// The log line proves the main bundle loaded.
export default class PrometheusMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[prometheus] main process extension activated");
  }
}
