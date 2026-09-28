import { describeDuration, describeProgress, type ScanProgress } from "../api/scan-progress";

const TONE: Record<ScanProgress["state"], string> = {
  "nothing-known": "",
  complete: "",
  working: "",
  stalled: " Trivy-banner--critical",
  stale: " Trivy-banner--critical",
};

/**
 * Whether to wait or to investigate. A cluster working through a rescan and
 * one whose operator died look identical in any list of reports; the times are
 * what tell them apart, so the times are what this says.
 */
export function ScanProgressBanner({ progress }: { progress: ScanProgress }) {
  if (progress.state === "complete" || progress.state === "nothing-known") return null;

  return (
    <div className={`Trivy-banner${TONE[progress.state]}`}>
      <span className="Trivy-banner__title">{describeProgress(progress)}</span>
      {progress.oldestAgeMs !== undefined && (
        <span className="Trivy-banner__body">
          Newest verdict {describeDuration(progress.newestAgeMs ?? 0)} old, oldest{" "}
          {describeDuration(progress.oldestAgeMs)}.
        </span>
      )}
    </div>
  );
}
