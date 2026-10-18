import { Renderer } from "@freelensapp/extensions";

import type {
  AlertmanagerLike,
  Binding,
  InstanceStatus,
  MonitoringCRD,
  MonitorSpec,
  PrometheusSpec,
  RuleSpec,
  TargetAllocatorSpec,
} from "./types";

const GROUP = "monitoring.coreos.com";

type Metadata = Renderer.K8sApi.KubeObjectMetadata;
type ConfigStatus = { bindings?: Binding[] };

function crd(
  version: "v1" | "v1alpha1",
  plural: string,
  singular: string,
  title: string,
  shortNames?: string[],
): MonitoringCRD {
  return { apiVersions: [`${GROUP}/${version}`], plural, singular, shortNames, title };
}

export class ServiceMonitor extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  ConfigStatus,
  MonitorSpec
> {
  static override readonly kind = "ServiceMonitor";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1/servicemonitors`;
  static override readonly crd = crd(
    "v1",
    "servicemonitors",
    "servicemonitor",
    "Service monitors",
    ["smon"],
  );
}

export class PodMonitor extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  ConfigStatus,
  MonitorSpec
> {
  static override readonly kind = "PodMonitor";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1/podmonitors`;
  static override readonly crd = crd("v1", "podmonitors", "podmonitor", "Pod monitors", ["pmon"]);
}

export class ScrapeConfig extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  ConfigStatus,
  MonitorSpec
> {
  static override readonly kind = "ScrapeConfig";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1alpha1/scrapeconfigs`;
  static override readonly crd = crd(
    "v1alpha1",
    "scrapeconfigs",
    "scrapeconfig",
    "Scrape configs",
    ["scfg"],
  );
}

export class PrometheusRule extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  ConfigStatus,
  RuleSpec
> {
  static override readonly kind = "PrometheusRule";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1/prometheusrules`;
  static override readonly crd = crd(
    "v1",
    "prometheusrules",
    "prometheusrule",
    "Prometheus rules",
    ["promrule"],
  );
}

export class Prometheus extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  InstanceStatus,
  PrometheusSpec
> {
  static override readonly kind = "Prometheus";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1/prometheuses`;
  static override readonly crd = crd("v1", "prometheuses", "prometheus", "Prometheuses", ["prom"]);
}

export class PrometheusAgent extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  InstanceStatus,
  PrometheusSpec
> {
  static override readonly kind = "PrometheusAgent";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1alpha1/prometheusagents`;
  static override readonly crd = crd(
    "v1alpha1",
    "prometheusagents",
    "prometheusagent",
    "Prometheus agents",
    ["promagent"],
  );
}

export class Alertmanager extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  InstanceStatus,
  AlertmanagerLike["spec"]
> {
  static override readonly kind = "Alertmanager";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${GROUP}/v1/alertmanagers`;
  static override readonly crd = crd("v1", "alertmanagers", "alertmanager", "Alertmanagers", [
    "am",
  ]);
}

// Read only for spec.targetAllocator; v1beta1 is the storage version, so no conversion webhook runs.
export class OpenTelemetryCollector extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  unknown,
  { mode?: string; targetAllocator?: TargetAllocatorSpec }
> {
  static override readonly kind = "OpenTelemetryCollector";
  static override readonly namespaced = true;
  static override readonly apiBase = "/apis/opentelemetry.io/v1beta1/opentelemetrycollectors";
  static override readonly crd: MonitoringCRD = {
    apiVersions: ["opentelemetry.io/v1beta1"],
    plural: "opentelemetrycollectors",
    singular: "opentelemetrycollector",
    shortNames: ["otelcol", "otelcols"],
    title: "OpenTelemetry collectors",
  };
}
