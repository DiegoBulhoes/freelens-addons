import { Main } from "@freelensapp/extensions";

// The log line proves the main bundle loaded.
export default class __Name__Main extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[__NAME__] main process extension activated");
  }
}
