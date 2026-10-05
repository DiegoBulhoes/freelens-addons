import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  drawerTitle,
  openDrawer,
  openWorkbench,
  waitFor,
} from "../../../build/e2e/freelens";
import {
  clusterObject,
  confirmDialog,
  type KubeObject,
  notificationMatching,
  untilCluster,
} from "../../../build/e2e/writes";

const DRAWER = ".CertManagerObjectDrawer";
const LIST = '[data-section="cert-manager-certificates"]';
const CERTIFICATES = "/apis/cert-manager.io/v1/namespaces/demo/certificates";
const REQUESTS = "/apis/cert-manager.io/v1/namespaces/demo/certificaterequests";

// Only certificates nothing mounts and that stay in the same state once renewed: the CA and the
// ones workloads serve are left alone, since a renewal rotates the key.
describe("cert-manager renewals, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const js = <T>(code: string) => session.evaluate<T>(code, frame);
  const certificate = (name: string) => clusterObject(session, frame, `${CERTIFICATES}/${name}`);
  const condition = (object: KubeObject | undefined, type: string) =>
    object?.status?.conditions?.find((each: KubeObject) => each.type === type);

  /** Renewed: the next revision is Ready, nothing is issuing, and its request carries that revision. */
  const renewed = async (name: string, revision: number) => {
    const now = await certificate(name);

    if (now?.status?.revision !== revision + 1) return false;
    if (condition(now, "Issuing") || condition(now, "Ready")?.status !== "True") return false;

    const requests = await clusterItems<KubeObject>(session, frame, REQUESTS);

    return requests.some(
      (each) =>
        each.metadata.annotations?.["cert-manager.io/certificate-name"] === name &&
        each.metadata.annotations?.["cert-manager.io/certificate-revision"] ===
          String(revision + 1),
    );
  };

  const showCertificates = async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor("the certificates", async () =>
      (await js<number>(`document.querySelectorAll('${LIST} tbody tr').length`)) > 1
        ? true
        : undefined,
    );
  };

  const rowOf = (name: string) =>
    `[...document.querySelectorAll('${LIST} tbody tr')].find((row) => [...row.querySelectorAll("td")].some((cell) => cell.textContent.trim() === ${JSON.stringify(name)}))`;

  it("renews web-tls from its drawer: a new revision, issued and ready", async () => {
    const revision: number = (await certificate("web-tls"))?.status?.revision;

    await showCertificates();
    await js(`${rowOf("web-tls")}.querySelector("td:not(.CertManager-table__check)").click()`);
    await waitFor("web-tls's drawer", async () =>
      (await drawerTitle(session, frame, DRAWER)) === "Certificate: web-tls" ? true : undefined,
    );
    await js(
      `[...(${openDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => each.textContent.trim() === "autorenew").click()`,
    );
    await confirmDialog(session, frame, "Renew");
    await notificationMatching(session, frame, /Renewal requested for web-tls in demo/);

    await untilCluster("web-tls renewed", () => renewed("web-tls", revision));
  });

  it("renews two ticked certificates from the list, one after the other", async () => {
    const names = ["ends-this-month", "managed-tls"];
    const revisions = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [name, (await certificate(name))?.status?.revision]),
      ),
    );

    await showCertificates();
    for (const name of names) {
      await js(`${rowOf(name)}.querySelector(".CertManager-table__check input").click()`);
    }
    await clickByText(session, frame, '[data-section="selection"] button', "Renew");
    const dialog = await confirmDialog(session, frame, "Renew 2", "confirm");

    expect(dialog).toMatch(/Renew 2 certificates\?/);
    await notificationMatching(session, frame, /Requested renewal for 2 of 2/);

    for (const name of names) {
      await untilCluster(`${name} renewed`, () => renewed(name, revisions[name]));
    }
  });
});
