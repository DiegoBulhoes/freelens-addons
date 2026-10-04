import type { Verdict } from "../api/clusters";
import { Status } from "./status";

/** A state, why, and barman's cause when there is one: visible, not only in a tooltip. */
export function StateCell({ verdict, cause }: { verdict: Verdict; cause?: string }) {
  // The operator's reason is often a bare exit status; barman's cause replaces it when known.
  const why = verdict.tone === "ok" || cause ? undefined : verdict.reason;

  return (
    <span className="CNPG-truncate" title={[verdict.reason, cause].filter(Boolean).join("\n")}>
      <Status tone={verdict.tone} label={verdict.label} />
      {why && <span className="CNPG-muted"> · {why}</span>}
      {cause && <span className={`CNPG-text--${verdict.tone}`}> · {cause}</span>}
    </span>
  );
}
