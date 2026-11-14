import css from "../styles/__NAME__.css?inline";
import design from "../styles/design.css?inline";

// Inline: a separate stylesheet would ship beside the bundle. Design standard first, so
// this extension's rules come after and can remap a tone.
export function __Name__Styles() {
  return <style>{design + css}</style>;
}
