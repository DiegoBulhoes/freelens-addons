import { Main } from "@freelensapp/extensions";

// The log line proves the main bundle loaded.
export default class OpenTelemetryMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[opentelemetry] main process extension activated");
  }
}
