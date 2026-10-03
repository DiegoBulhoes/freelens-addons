import css from "../styles/argocd.css?inline";
import design from "../styles/design.css?inline";

// A CommonJS bundle has no HTML to link from, so Vite's CSS injection does not apply.
// design.css first, so argocd.css can override it.
export function ArgoCDStyles() {
  return <style>{design + css}</style>;
}
