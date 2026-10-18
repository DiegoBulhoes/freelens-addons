import type { Session } from "../../../../build/e2e/cdp";
import { clusterItems, shownDrawer } from "../../../../build/e2e/freelens";

export const DRAWER = ".CertManagerObjectDrawer";
export const COMMANDS = `${DRAWER} [data-section="cert-manager-commands"]`;
export const LIST = '[data-section="cert-manager-certificates"]';
export const CERTIFICATE_ROWS = `${LIST} tbody tr`;
export const ISSUER_ROWS = '[data-section="cert-manager-issuers"] tbody tr';
export const SERVED_ROWS = '[data-section="served"] tbody tr';

export interface Conditioned {
  metadata: { namespace?: string; name: string };
  status?: { conditions?: { type: string; status: string; lastTransitionTime?: string }[] };
}

export const conditionOf = (object: Conditioned, type: string) =>
  object.status?.conditions?.find((each) => each.type === type);

// A renewal sets Issuing; nothing else in the cluster moves it while the suite runs.
export const issuingSnapshot = async (session: Session, frame: number) =>
  (await clusterItems<Conditioned>(session, frame, "/apis/cert-manager.io/v1/certificates"))
    .map((each) => {
      const condition = conditionOf(each, "Issuing");

      return `${each.metadata.namespace}/${each.metadata.name} ${condition?.status ?? "-"} ${condition?.lastTransitionTime ?? "-"}`;
    })
    .sort();

/** The expression for the open drawer's title-bar icon, such as `autorenew`; undefined when none matches. */
export const drawerIcon = (icon: string) =>
  `[...(${shownDrawer(DRAWER)}?.querySelectorAll('.drawer-title i.Icon') ?? [])].find((each) => each.textContent.trim() === ${JSON.stringify(icon)})`;

export const clickDrawerIcon = (session: Session, frame: number, icon: string) =>
  session.evaluate(`${drawerIcon(icon)}.click()`, frame);

// The drawer may already be closed, so a missing icon is not an error.
export const clickDrawerClose = (session: Session, frame: number) =>
  session.evaluate(`${drawerIcon("close")}?.click()`, frame);
