import { Renderer } from "@freelensapp/extensions";

const {
  Component: { NamespaceSelectFilter },
} = Renderer;

export function NamespaceFilter() {
  return (
    <div className="__Name__-namespaces">
      <NamespaceSelectFilter id="__NAME__-namespace-select" />
    </div>
  );
}
