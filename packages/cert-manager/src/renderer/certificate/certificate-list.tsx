import { certificateStatusOf } from "../api/attention";
import { ALARM_DAYS, describeTimeLeft, expiresWithin } from "../api/expiry";
import type { CertificateLike } from "../api/types";
import { Status } from "../components/status";

export function certificateKey(certificate: {
  getNs(): string | undefined;
  getName(): string;
}): string {
  return `${certificate.getNs() ?? ""}/${certificate.getName()}`;
}

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
        const status = certificateStatusOf(certificate, now);
        const alarm = expiresWithin(certificate, now, ALARM_DAYS);

        return (
          <button
            type="button"
            key={key}
            className={`CertManager-picker__item${key === selected ? " CertManager-picker__item--selected" : ""}`}
            title={`Shows ${certificate.getName()} beside the list`}
            onClick={() => onSelect(certificate)}
          >
            <span className="CertManager-picker__name">{certificate.getName()}</span>
            <span className="CertManager-picker__meta">
              {certificate.getNs()} · <Status tone={status.tone} label={status.label} />
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
