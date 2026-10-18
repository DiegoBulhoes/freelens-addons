import type { Verdict } from "../api/shared/verdict";
import { Status } from "./status";

export function StateCell({ verdict }: { verdict: Verdict }) {
  return (
    <span className="OpenTelemetry-truncate" title={verdict.reason}>
      <Status tone={verdict.tone} label={verdict.label} />
      {verdict.tone !== "ok" && <span className="OpenTelemetry-muted"> · {verdict.reason}</span>}
    </span>
  );
}
