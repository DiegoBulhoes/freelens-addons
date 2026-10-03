import { Renderer } from "@freelensapp/extensions";

const {
  Component: { NamespaceSelectFilter },
} = Renderer;

/** The host's selector: choosing here changes the scope everywhere in Freelens. */
export function NamespaceFilter() {
  return (
    <div className="ArgoCD-namespaces">
      <NamespaceSelectFilter id="argocd-namespace-select" />
    </div>
  );
}
