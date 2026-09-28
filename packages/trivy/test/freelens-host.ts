import { KubeApi } from "@freelensapp/kube-api";
import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";

/**
 * What `@freelensapp/extensions` resolves to under test.
 *
 * In the built extension that module is not bundled at all: `global-externals`
 * rewrites it to `globalThis.LensExtensions`, which the Freelens process
 * supplies. This file is the same substitution pointed somewhere else — the
 * standalone packages the host itself is built from — so the code under test
 * runs against the real `KubeObject` and the real `KubeApi`, with real
 * accessors, real `selfLink` validation, and real label parsing.
 *
 * That matters more than it sounds. A hand-written stand-in for `KubeObject`
 * would accept fixtures the real constructor rejects, and `getAnnotations()`
 * returning `"key=value"` strings rather than an object is exactly the kind of
 * detail a stand-in gets wrong and the code depends on.
 *
 * Two things here are not the host's own implementations, and neither is
 * exercised by any test:
 *
 * - `LensExtensionKubeObject.getApi` / `.getStore` throw. That is what the
 *   real ones do before the extension is registered, which is the state any
 *   test is in; the difference is the message.
 * - `KubeObjectStore` is a bare class. It lives in `@freelensapp/core`, which
 *   cannot load outside Electron, and the only thing the extension does with
 *   it is `class ApplicationStore extends …` — a type-level extension point
 *   that nothing calls.
 */

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

/**
 * Only the corner of the surface the api/ modules reference. A module that
 * reaches for something absent fails loudly at import, which is the honest
 * outcome: it means the module touches the host and belongs behind a split
 * like `coverage.ts` rather than in a unit test.
 */
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
