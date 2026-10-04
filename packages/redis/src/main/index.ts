import { Main } from "@freelensapp/extensions";

// The log line proves the main bundle loaded.
export default class RedisMain extends Main.LensExtension {
  override async onActivate(): Promise<void> {
    console.log("[redis] main process extension activated");
  }
}
