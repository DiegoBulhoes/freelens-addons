import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";

import { renewCertificate } from "../api/actions";
import type { RenewalVerdict } from "../api/renewal";
import type { CertificateLike } from "../api/types";

const {
  Component: { ConfirmDialog, Notifications },
} = Renderer;

/**
 * Force a renewal, after saying what that means. The only control in the
 * extension that writes, so it asks first, and it says why when it is not
 * offered — a disabled button that cannot be hovered for a reason is a dead end.
 */
export function RenewButton({
  certificate,
  verdict,
}: {
  certificate: CertificateLike;
  verdict: RenewalVerdict;
}) {
  const [working, setWorking] = useState(false);
  const name = certificate.getName();

  const confirm = () =>
    ConfirmDialog.open({
      labelOk: "Renew",
      okButtonProps: { primary: true },
      // The dialog is the host's, outside this extension's root: the root class
      // is what gives its message the tokens the tones resolve through.
      message: (
        <div className="CertManager">
          <p>
            Renew <b>{name}</b> in <b>{certificate.getNs()}</b> now?
          </p>
          <p className="CertManager-muted">
            cert-manager requests a new certificate from the same issuer. The current one stays in
            use until the new one is ready.
          </p>
          {verdict.offer && verdict.warning && (
            <p className="CertManager-text--warning">{verdict.warning}</p>
          )}
        </div>
      ),
      ok: async () => {
        setWorking(true);

        try {
          const outcome = await renewCertificate(certificate);

          if (outcome.ok) Notifications.ok(`Renewal of ${name} triggered.`);
          else Notifications.error(outcome.message);
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
        disabled={!verdict.offer || working}
        onClick={confirm}
      >
        {working ? "Renewing…" : "Renew now"}
      </button>
      {!verdict.offer && <span className="CertManager-hint">{verdict.reason}</span>}
    </div>
  );
}
