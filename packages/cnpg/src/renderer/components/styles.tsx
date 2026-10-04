import css from "../styles/cnpg.css?inline";
import design from "../styles/design.css?inline";

// A CommonJS bundle has no HTML for Vite to inject CSS into. Design standard first, so
// this extension's rules come after and can remap a tone.
export function CNPGStyles() {
  return <style>{design + css}</style>;
}
