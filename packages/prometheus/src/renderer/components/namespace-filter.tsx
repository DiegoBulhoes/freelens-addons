import { Renderer } from "@freelensapp/extensions";

const {
  Component: { NamespaceSelectFilter },
} = Renderer;

export function NamespaceFilter() {
  return (
    <div className="Prometheus-namespaces">
      <NamespaceSelectFilter id="prometheus-namespace-select" />
    </div>
  );
}
