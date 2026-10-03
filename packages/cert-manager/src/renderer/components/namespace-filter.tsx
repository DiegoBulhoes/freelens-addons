import { Renderer } from "@freelensapp/extensions";

const {
  Component: { NamespaceSelectFilter },
} = Renderer;

export function NamespaceFilter() {
  return (
    <div className="CertManager-namespaces">
      <NamespaceSelectFilter id="cert-manager-namespace-select" />
    </div>
  );
}
