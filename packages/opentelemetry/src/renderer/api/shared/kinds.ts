import { Renderer } from "@freelensapp/extensions";

import type {
  CollectorSpec,
  CollectorStatus,
  InstrumentationSpec,
  InstrumentationStatus,
  OtelCRD,
} from "./types";

const GROUP = "opentelemetry.io";
const V1ALPHA1 = `${GROUP}/v1alpha1` as const;
const V1BETA1 = `${GROUP}/v1beta1` as const;

type Metadata = Renderer.K8sApi.KubeObjectMetadata;

export class Instrumentation extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  InstrumentationStatus,
  InstrumentationSpec
> {
  declare kind: "Instrumentation";
  declare apiVersion: typeof V1ALPHA1;
  static override readonly kind = "Instrumentation";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${V1ALPHA1}/instrumentations`;
  static override readonly crd: OtelCRD = {
    apiVersions: [V1ALPHA1],
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
  declare kind: "OpenTelemetryCollector";
  declare apiVersion: typeof V1BETA1;
  static override readonly kind = "OpenTelemetryCollector";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${V1BETA1}/opentelemetrycollectors`;
  static override readonly crd: OtelCRD = {
    apiVersions: [V1BETA1],
    plural: "opentelemetrycollectors",
    singular: "opentelemetrycollector",
    shortNames: ["otelcol", "otelcols"],
    title: "OpenTelemetry collectors",
  };
}
