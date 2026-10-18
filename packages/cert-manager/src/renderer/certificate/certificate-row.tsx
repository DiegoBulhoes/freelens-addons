import type { ReactNode } from "react";

import type { CertificateLike } from "../api/shared/types";
import type { Tone } from "../components/status";

export function CertificateRow({
  certificate,
  state,
  tone,
  meta,
  reason,
  aside,
  onOpen,
}: {
  certificate: CertificateLike;
  state: string;
  tone: Tone;
  meta: ReactNode;
  reason?: string;
  aside: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`CertManager-row CertManager-row--${tone}`}
      title={`Opens ${certificate.getName()} in the certificates page`}
      onClick={(event) => {
        // Unprevented, the drawer this opens takes the click as outside and closes.
        event.preventDefault();
        onOpen();
      }}
    >
      <span className="CertManager-row__state">{state}</span>
      <span className="CertManager-row__main">
        <span className="CertManager-row__name">
          <b>{certificate.getName()}</b>
          <span className="CertManager-row__meta">{meta}</span>
        </span>
        {reason !== undefined && <span className="CertManager-row__reason">{reason}</span>}
      </span>
      <span className="CertManager-row__aside">{aside}</span>
    </button>
  );
}
