import design from "../styles/design.css?inline";
import css from "../styles/trivy.css?inline";

// Inline: a separate stylesheet would ship beside the bundle, which the bundle checks refuse.
// The standard first, so this extension's rules can remap a tone.
export function TrivyStyles() {
  return <style>{design + css}</style>;
}
