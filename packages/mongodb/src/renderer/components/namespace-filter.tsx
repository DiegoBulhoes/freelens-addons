import { Renderer } from "@freelensapp/extensions";

const {
  Component: { NamespaceSelectFilter },
} = Renderer;

export function NamespaceFilter() {
  return (
    <div className="MongoDB-namespaces">
      <NamespaceSelectFilter id="mongodb-namespace-select" />
    </div>
  );
}
