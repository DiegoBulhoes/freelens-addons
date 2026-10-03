import { KubeApi } from "@freelensapp/kube-api";
import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";

// `@freelensapp/extensions` under test: the real KubeObject and KubeApi from the standalone packages.
// getApi/getStore throw as before registration; KubeObjectStore is bare, since @freelensapp/core needs Electron.

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

class KubeObjectStore {}

// Only what api/ references; anything else fails at import.
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
