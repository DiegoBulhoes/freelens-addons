import { Renderer } from "@freelensapp/extensions";

import type {
  CollectorSpec,
  CollectorStatus,
  InstrumentationSpec,
  InstrumentationStatus,
  OtelCRD,
} from "./types";

const GROUP = "opentelemetry.io";

type Metadata = Renderer.K8sApi.KubeObjectMetadata;

export class Instrumentation extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  InstrumentationStatus,
  InstrumentationSpec
> {
  static override readonly kind = "Instrumentation";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1alpha1/instrumentations`;
  static override readonly crd: OtelCRD = {
    apiVersions: [`${GROUP}/v1alpha1`],
    plural: "instrumentations",
    singular: "instrumentation",
    shortNames: ["otelinst", "otelinsts"],
    title: "Instrumentations",
  };
}

// v1beta1 is the storage version: reading it needs no conversion by the operator's webhook.
export class OpenTelemetryCollector extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  CollectorStatus,
  CollectorSpec
> {
  static override readonly kind = "OpenTelemetryCollector";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1beta1/opentelemetrycollectors`;
  static override readonly crd: OtelCRD = {
    apiVersions: [`${GROUP}/v1beta1`],
    plural: "opentelemetrycollectors",
    singular: "opentelemetrycollector",
    shortNames: ["otelcol", "otelcols"],
    title: "OpenTelemetry collectors",
  };
}
