import { Renderer } from "@freelensapp/extensions";

import { renewCertificate } from "../api/actions";
import type { RenewalVerdict } from "../api/renewal";
import type { CertificateLike } from "../api/types";
import { confirmWrite, notifyDone } from "../components/confirm";
import type { DrawerAction } from "../components/object-drawer";

const {
  Component: { Notifications },
} = Renderer;

// No typed name (one object, nothing removed) and no Undo (a renewal cannot be taken back).
export function confirmRenew(certificate: CertificateLike, verdict: RenewalVerdict): void {
  if (!verdict.offer) {
    Notifications.error(verdict.reason);
    return;
  }

  const name = certificate.getName();
  const namespace = certificate.getNs();

  confirmWrite({
    question: (
      <>
        Renew <b>{name}</b> in <b>{namespace}</b> now?
      </>
    ),
    detail:
      "cert-manager requests a new certificate from the same issuer. The current one stays in use until the new one is ready.",
    warning: verdict.warning,
    label: "Renew",
    destructive: false,
    ok: async () => {
      try {
        const outcome = await renewCertificate(certificate);

        if (outcome.ok) {
          notifyDone(`Renewal requested for ${name} in ${namespace}. cert-manager is issuing it.`);
        } else {
          Notifications.error(outcome.message);
        }
      } catch (error) {
        Notifications.error(`Could not reach the API server: ${String(error)}`);
      }
    },
  });
}

export function renewAction(certificate: CertificateLike, verdict: RenewalVerdict): DrawerAction {
  return {
    icon: "autorenew",
    title: verdict.offer
      ? "Asks cert-manager to issue a new certificate now; the current one stays in use until then. Asks first"
      : `Not offered: ${verdict.reason}`,
    onClick: () => confirmRenew(certificate, verdict),
  };
}

/** For bulk renewal: a refusal is thrown, so the outcome names it. */
export async function renewOrThrow(certificate: CertificateLike): Promise<void> {
  const outcome = await renewCertificate(certificate);

  if (!outcome.ok) throw new Error(outcome.message);
}
