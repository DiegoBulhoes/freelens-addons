import { KubeApi } from "@freelensapp/kube-api";
import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";

// What `@freelensapp/extensions` resolves to under test: the real KubeObject and KubeApi.
// getApi/getStore throw and KubeObjectStore is a bare class; no test exercises either.

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

// Only what api/ references: a module needing more touches the host and is not unit-tested.
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
