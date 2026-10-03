import css from "../styles/cert-manager.css?inline";
import design from "../styles/design.css?inline";

// A CommonJS bundle has no HTML to link from, so Vite's CSS injection does not apply.
// Design standard first, so this extension's rules come after and can remap a tone.
export function CertManagerStyles() {
  return <style>{design + css}</style>;
}
