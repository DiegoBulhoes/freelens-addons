import design from "../styles/design.css?inline";
import css from "../styles/trivy.css?inline";

// A CommonJS bundle has no HTML to link from, so Vite's CSS injection does not apply.
// The standard first, so this extension's rules can remap a tone.
export function TrivyStyles() {
  return <style>{design + css}</style>;
}
