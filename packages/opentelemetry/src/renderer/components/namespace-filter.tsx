import { Renderer } from "@freelensapp/extensions";

const {
  Component: { NamespaceSelectFilter },
} = Renderer;

export function NamespaceFilter() {
  return (
    <div className="OpenTelemetry-namespaces">
      <NamespaceSelectFilter id="opentelemetry-namespace-select" />
    </div>
  );
}
