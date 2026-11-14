import design from "../styles/design.css?inline";
import css from "../styles/prometheus.css?inline";

// Inline: a separate stylesheet would ship beside the bundle, which the bundle checks refuse.
// The standard first, so this extension's rules can remap a tone.
export function PrometheusStyles() {
  return <style>{design + css}</style>;
}
