import { Main } from "@freelensapp/extensions";

// The log line proves the main bundle loaded.
export default class CNPGMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[cnpg] main process extension activated");
  }
}
