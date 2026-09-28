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
 * What this extension's overview shows after the namespace scope changes under it.
 *
 * The host's list pages reload when the selection moves. Ours loads its stores
 * itself, from a hook, and a store is shared with the rest of Freelens — so
 * `isLoaded` says a list arrived once, not that it was listed under the scope
 * that is current now. A hook that skips loading because the store is already
 * loaded leaves the page showing whatever scope some other page's first mount
 * happened to fetch, with no way back short of restarting the app.
 *
 * That was a real defect here, and the same one sat in the Trivy extension's hook
 * — `packages/trivy/e2e/namespace-scope.e2e.ts` is its twin, and a change to how
 * either loads should be tried against both.
 *
 * This is the one file that does not use `openWorkbench`: widening the scope
 * before our pages ever mount is exactly what hides the defect. The order here is
 * the order a person produces — narrow, look, widen, look again.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

/** Holds no Applications — ArgoCD keeps its own in the namespace it runs in. */
const EMPTY_NAMESPACE = "default";

describe("changing the namespace scope under the ArgoCD overview", () => {
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

    await clickSidebar(session, frame, "argocd-dashboard", "argocd");

    const headline = await waitFor("the ArgoCD headline", async () => {
      const text = await textOf(session, frame, ".ArgoCD-page__headline");

      return text.length > 0 ? text : undefined;
    });

    expect(headline).toMatch(/No ArgoCD Applications/i);
  }, 120_000);

  it("catches up once the scope widens", async () => {
    // Back to a page that carries the control, widen, then return to ours. The
    // stores are already loaded at this point, which is the whole trap.
    await clickSidebar(session, frame, "pods", "workloads");
    await selectAllNamespaces(session, frame);

    await clickSidebar(session, frame, "argocd-dashboard", "argocd");

    const headline = await waitFor("the ArgoCD headline to count something", async () => {
      const text = await textOf(session, frame, ".ArgoCD-page__headline");

      return /No ArgoCD Applications/i.test(text) || text.length === 0 ? undefined : text;
    });

    expect(headline).toMatch(/of [1-9]\d* Applications|in sync/i);
  }, 120_000);
});
