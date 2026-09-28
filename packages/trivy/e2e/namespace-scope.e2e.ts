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
 * themselves, from a hook, and a store is shared with the rest of Freelens — so
 * `isLoaded` says a list arrived once, not that it was listed under the scope
 * that is current now. A hook that skips loading because the store is already
 * loaded leaves the page showing whatever scope some other page's first mount
 * happened to fetch, with no way back short of restarting the app.
 *
 * That was a real defect here, and the same one sat in the ArgoCD extension's
 * hook — `packages/argocd/e2e/namespace-scope.e2e.ts` is its twin, and a change
 * to how either loads should be tried against both.
 *
 * This is the one file that does not use `openWorkbench`: widening the scope
 * before our pages ever mount is exactly what hides the defect. The order here is
 * the order a person produces — narrow, look, widen, look again.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

/** Holds no scanned workload, so the overview must report emptiness. */
const EMPTY_NAMESPACE = "default";

describe("changing the namespace scope under the Trivy pages", () => {
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

  it("reports emptiness while scoped to a namespace that has nothing", async () => {
    await selectNamespace(session, frame, EMPTY_NAMESPACE);

    await clickSidebar(session, frame, "trivy-dashboard", "trivy");

    const headline = await waitFor("the Trivy headline", async () => {
      const text = await textOf(session, frame, ".Trivy-page__headline");

      return text.length > 0 ? text : undefined;
    });

    expect(headline).toMatch(/0 critical findings in 0/);
  }, 120_000);

  it("catches up once the scope widens", async () => {
    // Back to a page that carries the control, widen, then return to ours. The
    // stores are already loaded at this point, which is the whole trap.
    await clickSidebar(session, frame, "pods", "workloads");
    await selectAllNamespaces(session, frame);

    await clickSidebar(session, frame, "trivy-dashboard", "trivy");

    const headline = await waitFor("the Trivy headline to count something", async () => {
      const text = await textOf(session, frame, ".Trivy-page__headline");

      return /0 critical findings in 0/.test(text) || text.length === 0 ? undefined : text;
    });

    expect(headline).toMatch(/critical findings in [1-9]\d* scanned workloads/);
  }, 120_000);
});
