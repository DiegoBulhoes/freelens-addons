import design from "../styles/design.css?inline";
import css from "../styles/prometheus.css?inline";

// No HTML to inject CSS into; the standard comes first so this extension's rules can remap a tone.
export function PrometheusStyles() {
  return <style>{design + css}</style>;
}
