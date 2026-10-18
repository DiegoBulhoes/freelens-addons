import design from "../styles/design.css?inline";
import css from "../styles/opentelemetry.css?inline";

// No HTML to inject CSS into; the standard comes first so this extension's rules can remap a tone.
export function OpenTelemetryStyles() {
  return <style>{design + css}</style>;
}
