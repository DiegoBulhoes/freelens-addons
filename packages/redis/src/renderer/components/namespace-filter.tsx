import { Renderer } from "@freelensapp/extensions";

const {
  Component: { NamespaceSelectFilter },
} = Renderer;

export function NamespaceFilter() {
  return (
    <div className="Redis-namespaces">
      <NamespaceSelectFilter id="redis-namespace-select" />
    </div>
  );
}
