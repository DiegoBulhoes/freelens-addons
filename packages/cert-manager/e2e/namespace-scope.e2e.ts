import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterFrame,
  connect,
  openCluster,
  selectAllNamespaces,
  selectNamespace,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

/**
 * What this extension's pages show after the namespace scope changes under them.
 *
 * The host's list pages reload when the selection moves. Ours load their stores
 * from a hook, and a store is shared with the rest of Freelens — so `isLoaded`
 * says a list arrived once, not that it was listed under the scope that is
 * current now. A hook that skips loading because the store is already loaded
 * shows whatever some other page's first mount fetched, for the life of the app.
 *
 * That defect sat in both the ArgoCD and the Trivy hooks, and this extension's
 * hook was written knowing it. This file is the third twin of
 * `packages/trivy/e2e/namespace-scope.e2e.ts`: a change to how any of the three
 * loads should be tried against all three.
 *
 * It does not use `openWorkbench`: widening the scope before our pages mount is
 * exactly what hides the defect. Narrow, look, widen, look again.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

/** Holds no Certificate, so the overview must say so. */
const EMPTY_NAMESPACE = "default";

describe("changing the namespace scope under the cert-manager pages", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    session = await connect();
    await openCluster(session);
    frame = await clusterFrame(session);

    // The namespace control lives on the host's list pages, not on ours.
    await clickSidebar(session, frame, "pods", "workloads");
  }, 180_000);

  afterAll(() => session?.close());

  const headline = () =>
    waitFor("the cert-manager headline", async () => {
      const text = await textOf(session, frame, ".CertManager-page__headline");

      return text.length > 0 ? text : undefined;
    });

  it("reports nothing while scoped to a namespace that has no certificates", async () => {
    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");

    expect(await headline()).toBe("No certificates");
  }, 120_000);

  it("catches up once the scope widens", async () => {
    // Back to a page that carries the control, widen, then return to ours. The
    // stores are already loaded at this point, which is the whole trap.
    await clickSidebar(session, frame, "pods", "workloads");
    await selectAllNamespaces(session, frame);
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");

    const widened = await waitFor("the headline to count something", async () => {
      const text = await textOf(session, frame, ".CertManager-page__headline");

      return text === "No certificates" || text.length === 0 ? undefined : text;
    });

    expect(widened).toMatch(/of [1-9]\d* certificates|All [1-9]\d* certificates/);
  }, 120_000);
});
