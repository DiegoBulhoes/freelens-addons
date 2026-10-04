import design from "../styles/design.css?inline";
import css from "../styles/mongodb.css?inline";

// A CommonJS bundle has no HTML for Vite to inject CSS into. Design standard first, so
// this extension's rules come after and can remap a tone.
export function MongoDBStyles() {
  return <style>{design + css}</style>;
}
