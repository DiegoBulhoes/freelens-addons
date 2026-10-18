import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  type ErrorLog,
  openMenu,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { controlsHelpers } from "../support/argocd";
import { showAllAttention } from "../support/attention";

// Read-only on purpose: Sync and Refresh are opened as far as their confirmation, then cancelled.

describe("the controls on the ArgoCD pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { where, openDashboard } = controlsHelpers(() => ({ session, frame }));

  describe("the drawers of an Application and of a project", () => {
    const DETAILS = ".Drawer .ArgoCDApplicationDetails, .Drawer .ArgoCDAppProjectDetails";

    const drawerText = (selector: string) =>
      waitFor(`the drawer ${selector}`, async () => {
        const text = await session.evaluate<string>(
          `document.querySelector(${JSON.stringify(`.Drawer ${selector}`)})?.textContent ?? ""`,
          frame,
        );

        return text || undefined;
      });

    const openRow = async (list: string, name: string) => {
      const clicked = await session.evaluate<boolean>(
        `(() => {
          const row = [...document.querySelectorAll(${JSON.stringify(`${list} .TableRow`)})]
            .find((each) => [...each.querySelectorAll(".TableCell")].some((cell) => cell.textContent.trim() === ${JSON.stringify(name)}));
          row?.click();
          return Boolean(row);
        })()`,
        frame,
      );

      expect(clicked, `no row named ${name} in ${list}`).toBe(true);
    };

    const closeDrawer = async () => {
      await session.evaluate(
        `[...document.querySelectorAll(".Drawer .drawer-title i.Icon")].find((each) => each.textContent.trim() === "close")?.click()`,
        frame,
      );
      await waitFor("the drawer to close", async () =>
        (await countOf(session, frame, DETAILS)) === 0 ? true : undefined,
      );
    };

    it("shows an Application's sync, health, project and what manages it, and opens the project", async () => {
      await clickSidebar(session, frame, "argocd-applications", "argocd");
      await waitFor("the Applications", async () =>
        (await countOf(session, frame, ".ArgoCDApplications .TableRow")) > 1 ? true : undefined,
      );
      await openRow(".ArgoCDApplications", "example.sync-waves");

      const drawer = await drawerText(".ArgoCDApplicationDetails");

      expect(drawer).toMatch(/Sync\s*Synced/);
      expect(drawer).toMatch(/Health\s*Healthy/);
      expect(drawer).toMatch(/Managed by\s*Application\s*apps/);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);

      await clickWhenShown(
        session,
        frame,
        ".Drawer .ArgoCDApplicationDetails .ArgoCD-link",
        "default",
      );

      expect(await drawerText(".ArgoCDAppProjectDetails")).toMatch(/Applications \(2\)/);
      await closeDrawer();
    }, 90_000);

    it("draws a degraded Application's drawer, its banner and its commands, from the standard", async () => {
      await clickSidebar(session, frame, "argocd-applications", "argocd");
      await waitFor("the Applications", async () =>
        (await countOf(session, frame, ".ArgoCDApplications .TableRow")) > 1 ? true : undefined,
      );
      await openRow(".ArgoCDApplications", "image-updates");

      const drawer = await drawerText(".ArgoCDApplicationDetails");

      expect(drawer).toMatch(/Health\s*Degraded/);
      expect(
        await countOf(session, frame, ".Drawer .ArgoCDApplicationDetails .ArgoCD-banner"),
      ).toBe(1);
      expect(drawer).toContain("kubectl -n argocd get application image-updates -o yaml");
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
      await closeDrawer();
    }, 90_000);

    it("opens the exact Application an overview row names, with its drawer", async () => {
      await openDashboard();
      await showAllAttention(session, frame);

      const name = await textOf(session, frame, '[data-section="attention"] .ArgoCD-row__name b');

      await clickWhenShown(session, frame, '[data-section="attention"] .ArgoCD-row__main', name);

      const landed = await waitFor("the Applications list", async () => {
        const path = await where();

        return path.startsWith("/applications") ? path : undefined;
      });

      expect(landed).toContain(`name=${encodeURIComponent(name)}`);
      expect(landed).toContain("namespace=argocd");
      expect(await drawerText(".ArgoCDApplicationDetails")).toContain(name);
      await closeDrawer();
    }, 90_000);

    it("shows a project's windows, roles and kinds in full", async () => {
      await clickSidebar(session, frame, "argocd-projects", "argocd");
      await waitFor("the projects", async () =>
        (await countOf(session, frame, ".ArgoCDAppProjects .TableRow")) > 0 ? true : undefined,
      );
      await openRow(".ArgoCDAppProjects", "restricted");

      const drawer = await drawerText(".ArgoCDAppProjectDetails");

      expect(drawer).toContain("2 sync windows decide when its 0 Applications may sync.");
      expect(drawer).toContain("Sync windows (2)");
      expect(drawer).toContain("Weekend freeze");
      expect(drawer).toContain("Roles (2)");
      expect(drawer).toContain("restricted-deployers");
      expect(drawer).toMatch(/Namespaced kinds denied\s*ResourceQuota/);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
      await closeDrawer();
    }, 90_000);

    it("opens a project's Applications from its count, and says none of its deploys are held", async () => {
      const apps = await clusterItems<{ spec: { project?: string } }>(
        session,
        frame,
        "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications",
      );
      const own = apps.filter((each) => each.spec.project === "demo").length;

      await clickSidebar(session, frame, "argocd-projects", "argocd");
      await waitFor("the projects", async () =>
        (await countOf(session, frame, ".ArgoCDAppProjects .TableRow")) > 0 ? true : undefined,
      );

      const deploys = await session.evaluate<string[]>(
        `[...document.querySelectorAll(".ArgoCDAppProjects .TableRow")].map((row) => row.querySelectorAll(".TableCell")[3]?.textContent.trim() ?? "")`,
        frame,
      );

      expect(new Set(deploys), "a project shows held deploys, or no Deploys column").toEqual(
        new Set(["allowed"]),
      );

      const count = await session.evaluate<string>(
        `(() => {
          const row = [...document.querySelectorAll(".ArgoCDAppProjects .TableRow")]
            .find((each) => [...each.querySelectorAll(".TableCell")].some((cell) => cell.textContent.trim() === "demo"));
          const link = row?.querySelector("button.ArgoCD-link");
          link?.click();
          return link?.textContent.trim() ?? "";
        })()`,
        frame,
      );

      expect(Number(count)).toBe(own);

      const landed = await waitFor("the Applications list", async () => {
        const path = await where();

        return path.startsWith("/applications") ? path : undefined;
      });

      expect(landed).toContain("project=demo");
      expect(
        await countOf(session, frame, DETAILS),
        "the count also opened the project's drawer",
      ).toBe(0);
      await waitFor(`${own} Applications of demo`, async () =>
        (await countOf(session, frame, ".ArgoCDApplications .TableRow")) === own ? true : undefined,
      );
    }, 90_000);

    it("offers no Refresh all or Sync all on a project with no Applications", async () => {
      await clickSidebar(session, frame, "argocd-projects", "argocd");
      await waitFor("the projects", async () =>
        (await countOf(session, frame, ".ArgoCDAppProjects .TableRow")) > 0 ? true : undefined,
      );
      await session.evaluate(
        `[...document.querySelectorAll(".ArgoCDAppProjects .TableRow")]
           .find((row) => [...row.querySelectorAll(".TableCell")].some((cell) => cell.textContent.trim() === "restricted"))
           ?.querySelector(".TableCell.menu i.Icon")?.click()`,
        frame,
      );
      await openMenu(session, frame);

      const disabled = await session.evaluate<string[]>(
        "[...document.querySelectorAll('.MenuItem.disabled .title')].map((each) => each.textContent.trim())",
        frame,
      );

      expect(disabled).toEqual(expect.arrayContaining(["Refresh all", "Sync all"]));
      await session.evaluate(
        "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
        frame,
      );
    }, 60_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
