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

// Does not use `openWorkbench`: widening the scope before our pages mount hides the bug.
// Twin of packages/trivy/e2e/namespace-scope.e2e.ts; try loading changes against both.

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
    // The stores are already loaded here; the page must still reload under the new scope.
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

const OWN_SCREENS: [id: string, groups: string | string[]][] = [
  ["argocd-dashboard", "argocd"],
  ["image-updater-overview", ["argocd", "argocd-image-updater"]],
  ["image-updater-rules", ["argocd", "argocd-image-updater"]],
  ["image-updater-images", ["argocd", "argocd-image-updater"]],
  ["image-updater-updates", ["argocd", "argocd-image-updater"]],
];

describe("the namespace selector on the ArgoCD screens", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    session = await connect();
    await openCluster(session);
    frame = await clusterFrame(session);
  }, 180_000);

  afterAll(() => session?.close());

  const headline = (matching: RegExp) =>
    waitFor(`a headline matching ${matching}`, async () => {
      const text = await textOf(session, frame, ".ArgoCD-page__headline");

      return matching.test(text) ? text : undefined;
    });

  it.each(OWN_SCREENS)(
    "offers it on %s",
    async (id, groups) => {
      await clickSidebar(session, frame, id, groups);

      const selectors = await waitFor(`${id}'s namespace selector`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll('.ArgoCD-namespaces [class*="Select__control"]').length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(selectors).toBe(1);
    },
    60_000,
  );

  it("narrows the overview from its own selector, with the page open", async () => {
    await clickSidebar(session, frame, "argocd-dashboard", "argocd");
    await selectAllNamespaces(session, frame);
    await headline(/of [1-9]\d* Applications|in sync/i);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);

    expect(await headline(/No ArgoCD Applications/i)).toMatch(/No ArgoCD Applications/i);
  }, 120_000);

  it("widens it again from the same selector", async () => {
    await selectAllNamespaces(session, frame);

    expect(await headline(/of [1-9]\d* Applications|in sync/i)).toBeTruthy();
  }, 120_000);

  it("narrows the Image Updater overview the same way", async () => {
    await clickSidebar(session, frame, "image-updater-overview", [
      "argocd",
      "argocd-image-updater",
    ]);
    await headline(/\d+ of \d+ Image Updater rules|All \d+ Image Updater rules/);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    expect(await headline(/No Image Updater rules/)).toMatch(/No Image Updater rules/);

    await selectAllNamespaces(session, frame);
    expect(await headline(/Image Updater rules (need|are)/)).toBeTruthy();
  }, 120_000);
});
