import { Main } from "@freelensapp/extensions";

export default class TrivyMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[trivy] main process extension activated");
  }
}
