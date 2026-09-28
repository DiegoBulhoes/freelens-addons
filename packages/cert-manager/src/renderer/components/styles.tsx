import css from "../styles/cert-manager.css?inline";
import design from "../styles/design.css?inline";

// A CommonJS bundle has no HTML to link from, so Vite's CSS injection does not apply.
/**
 * Every page mounts this; the rules are identical, so the cost is a duplicate <style>.
 * The design standard first, so this extension's own rules — its domain's palette,
 * the few components only it has — come after and can remap a tone.
 */
export function CertManagerStyles() {
  return <style>{design + css}</style>;
}
