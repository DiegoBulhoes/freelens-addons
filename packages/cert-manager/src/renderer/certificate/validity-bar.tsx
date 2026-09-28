import { Renderer } from "@freelensapp/extensions";

import { describeMoment, formatUtc, type Validity } from "../api/expiry";

const {
  Component: { WithTooltip },
} = Renderer;

/**
 * Where now sits in a certificate's life, with the renewal time marked.
 *
 * A bar with "now" past the renewal mark says "this should have renewed" at a
 * glance, which is the one thing a list of certificates cannot show. Under it,
 * the three moments that bound it — issued, renewal due, expires — each with
 * its date and how far it is from now, so the glance and the numbers agree.
 */
export function ValidityBar({
  validity,
  overdue,
  now,
}: {
  validity: Validity;
  overdue: boolean;
  now: number;
}) {
  const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

  const moment = (label: string, at: number, modifier: string, late = false) => (
    <span className={`CertManager-validity__end CertManager-validity__end--${modifier}`}>
      <span>{label}</span>
      <span className="CertManager-validity__date">{formatUtc(at)}</span>
      <span className={late ? "CertManager-text--warning" : undefined}>
        {describeMoment(at, now)}
      </span>
    </span>
  );

  return (
    <div className="CertManager-validity">
      <div
        className={`CertManager-validity__track${overdue ? " CertManager-validity__track--overdue" : ""}`}
      >
        <div className="CertManager-validity__used" style={{ width: percent(validity.position) }} />

        {validity.renewalPosition !== undefined && validity.renewalTime !== undefined && (
          <span
            className="CertManager-validity__renewal"
            style={{ left: percent(validity.renewalPosition) }}
          >
            <WithTooltip tooltip={`Renewal due ${formatUtc(validity.renewalTime)}`}>
              <span className="CertManager-validity__renewal-mark" />
            </WithTooltip>
          </span>
        )}

        <span className="CertManager-validity__now" style={{ left: percent(validity.position) }} />
      </div>

      <div className="CertManager-validity__ends">
        {moment("issued", validity.notBefore, "first")}
        {validity.renewalTime !== undefined ? (
          moment("renewal due", validity.renewalTime, "middle", overdue)
        ) : (
          <span />
        )}
        {moment("expires", validity.notAfter, "last")}
      </div>
    </div>
  );
}
