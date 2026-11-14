import css from "../styles/cert-manager.css?inline";
import design from "../styles/design.css?inline";

// Inline: a separate stylesheet would ship beside the bundle, which the bundle checks refuse.
// Design standard first, so this extension's rules come after and can remap a tone.
export function CertManagerStyles() {
  return <style>{design + css}</style>;
}
