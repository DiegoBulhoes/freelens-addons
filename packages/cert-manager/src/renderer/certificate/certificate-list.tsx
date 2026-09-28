import { problemOf, severityOf } from "../api/attention";
import { ALARM_DAYS, describeTimeLeft, expiresWithin } from "../api/expiry";
import type { CertificateLike } from "../api/types";

const PROBLEM_LABEL = {
  expired: "expired",
  "not-ready": "not ready",
  "renewal-overdue": "renewal failing",
} as const;

export function certificateKey(certificate: {
  getNs(): string | undefined;
  getName(): string;
}): string {
  return `${certificate.getNs() ?? ""}/${certificate.getName()}`;
}

/** The selectable column. Narrow on purpose: the detail beside it is the content. */
export function CertificateList({
  certificates,
  selected,
  now,
  onSelect,
}: {
  certificates: CertificateLike[];
  selected?: string;
  now: number;
  onSelect: (certificate: CertificateLike) => void;
}) {
  return (
    <div className="CertManager-picker__list">
      {certificates.map((certificate) => {
        const key = certificateKey(certificate);
        const problem = problemOf(certificate, now);
        const alarm = expiresWithin(certificate, now, ALARM_DAYS);

        return (
          <button
            type="button"
            key={key}
            className={`CertManager-picker__item${key === selected ? " CertManager-picker__item--selected" : ""}`}
            onClick={() => onSelect(certificate)}
          >
            <span className="CertManager-picker__name">{certificate.getName()}</span>
            <span className="CertManager-picker__meta">
              {certificate.getNs()}
              {problem && (
                <span className={`CertManager-text--${severityOf(problem)}`}>
                  {" "}
                  · {PROBLEM_LABEL[problem]}
                </span>
              )}
            </span>
            <span
              className={`CertManager-picker__aside${alarm ? " CertManager-text--warning" : ""}`}
            >
              {describeTimeLeft(certificate, now)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
