import type { Fact } from "../api/coverage/facts";

export function Facts({ facts, mono }: { facts: Fact[]; mono?: string }) {
  return (
    <>
      {facts.map(({ term, value }) => (
        <div key={term} style={{ display: "contents" }}>
          <dt>{term}</dt>
          <dd className={term === mono ? "OpenTelemetry-mono" : undefined}>{value}</dd>
        </div>
      ))}
    </>
  );
}
