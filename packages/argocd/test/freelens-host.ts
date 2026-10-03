import { KubeApi } from "@freelensapp/kube-api";
import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";

/** `@freelensapp/extensions` under test: the real `KubeObject` and `KubeApi` from the standalone packages. */

class LensExtensionKubeObject<
  Metadata extends KubeObjectMetadata = KubeObjectMetadata,
  Status = unknown,
  Spec = unknown,
> extends KubeObject<Metadata, Status, Spec> {
  static readonly crd?: unknown;

  static getApi(): never {
    throw new Error("getApi() requires the extension to be registered with a running Freelens");
  }

  static getStore(): never {
    throw new Error("getStore() requires the extension to be registered with a running Freelens");
  }
}

// `@freelensapp/core` cannot load outside Electron; the extension only subclasses this.
class KubeObjectStore {}

/** Only what api/ modules reference; anything else failing at import belongs behind a store boundary. */
export const Renderer = {
  K8sApi: {
    KubeApi,
    KubeObject,
    KubeObjectStore,
    LensExtensionKubeObject,
  },
};

export const Main = {};
export const Common = {};
