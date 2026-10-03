import { Renderer } from "@freelensapp/extensions";

const {
  Component: { NamespaceSelectFilter },
} = Renderer;

export function NamespaceFilter() {
  return (
    <div className="Trivy-namespaces">
      <NamespaceSelectFilter id="trivy-namespace-select" />
    </div>
  );
}
