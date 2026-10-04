import { Main } from "@freelensapp/extensions";

// The log line proves the main bundle loaded.
export default class MongoDBMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[mongodb] main process extension activated");
  }
}
