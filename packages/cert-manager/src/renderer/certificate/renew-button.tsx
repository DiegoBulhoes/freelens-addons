import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";

import { renewCertificate } from "../api/actions";
import type { RenewalVerdict } from "../api/renewal";
import type { CertificateLike } from "../api/types";
import { confirmWrite, notifyDone } from "../components/confirm";

const {
  Component: { Notifications },
} = Renderer;

// No typed name (one object, nothing removed) and no Undo (a renewal cannot be taken back).
export function RenewButton({
  certificate,
  verdict,
}: {
  certificate: CertificateLike;
  verdict: RenewalVerdict;
}) {
  const [working, setWorking] = useState(false);
  const name = certificate.getName();
  const namespace = certificate.getNs();

  const confirm = () =>
    confirmWrite({
      question: (
        <>
          Renew <b>{name}</b> in <b>{namespace}</b> now?
        </>
      ),
      detail:
        "cert-manager requests a new certificate from the same issuer. The current one stays in use until the new one is ready.",
      warning: verdict.offer ? verdict.warning : undefined,
      label: "Renew",
      destructive: false,
      ok: async () => {
        setWorking(true);

        try {
          const outcome = await renewCertificate(certificate);

          if (outcome.ok) {
            notifyDone(
              `Renewal requested for ${name} in ${namespace}. cert-manager is issuing it.`,
            );
          } else {
            Notifications.error(outcome.message);
          }
        } catch (error) {
          Notifications.error(`Could not reach the API server: ${String(error)}`);
        } finally {
          setWorking(false);
        }
      },
    });

  return (
    <div className="CertManager-page__actions">
      <button
        type="button"
        className="CertManager-button CertManager-button--primary"
        title={
          verdict.offer
            ? "Asks cert-manager to issue a new certificate now; the current one stays in use until then"
            : verdict.reason
        }
        disabled={!verdict.offer || working}
        onClick={confirm}
      >
        Renew now
      </button>
      {!verdict.offer && <span className="CertManager-hint">{verdict.reason}</span>}
    </div>
  );
}
