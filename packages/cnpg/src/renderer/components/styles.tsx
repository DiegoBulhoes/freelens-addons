import css from "../styles/cnpg.css?inline";
import design from "../styles/design.css?inline";

// Inline: a separate stylesheet would ship beside the bundle, which the bundle checks refuse.
// The standard first, so this extension's rules can remap a tone.
export function CNPGStyles() {
  return <style>{design + css}</style>;
}
