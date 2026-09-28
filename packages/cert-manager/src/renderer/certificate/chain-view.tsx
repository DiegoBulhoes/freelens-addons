import type { ChainLink } from "../api/chain";

const STATE_LABEL: Record<ChainLink["state"], string> = {
  ok: "ok",
  pending: "waiting",
  failed: "failing",
  missing: "missing",
};

const TONE: Record<ChainLink["state"], string> = {
  ok: " CertManager-row--ok",
  pending: " CertManager-row--warning",
  failed: " CertManager-row--critical",
  missing: " CertManager-row--critical",
};

/**
 * Issuer → Certificate → CertificateRequest → Order → Challenge, one row each
 * in the standard's list, in order, with the link that causes the rest marked
 * as the cause. The reason sits on that link, where cert-manager put it, rather
 * than repeated on the Certificate that only shows the symptom.
 */
export function ChainView({ chain, explanation }: { chain: ChainLink[]; explanation?: ChainLink }) {
  return (
    <ol className="CertManager-list">
      {chain.map((link) => {
        const explains = link === explanation;

        return (
          <li
            key={`${link.kind}/${link.namespace ?? ""}/${link.name}`}
            className={`CertManager-row${TONE[link.state]}`}
            data-explains={explains || undefined}
          >
            <span className="CertManager-row__state">{STATE_LABEL[link.state]}</span>
            <span className="CertManager-row__main">
              <span className="CertManager-row__name">
                <b>{link.kind}</b>
                <code>{link.name}</code>
              </span>
              {link.reason && <span className="CertManager-row__reason">{link.reason}</span>}
            </span>
            {explains && <span className="CertManager-row__aside">the cause</span>}
          </li>
        );
      })}
    </ol>
  );
}
