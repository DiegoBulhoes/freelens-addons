import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";

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

  describe("the bar under the ticked rows of the Projects list", () => {
    const TICKS = ".ArgoCDAppProjects .TableRow .TableCell.checkbox";
    const BAR = '[data-section="selection"]';
    const PROJECTS = "/apis/argoproj.io/v1alpha1/appprojects";

    interface Project {
      metadata: { name: string };
      spec: { syncWindows?: { description?: string }[] };
    }

    const frozenOf = (projects: Project[]) =>
      projects
        .filter((project) =>
          (project.spec.syncWindows ?? []).some(
            (each) => each.description === "Frozen from Freelens",
          ),
        )
        .map((project) => project.metadata.name);

    beforeAll(async () => {
      await clickSidebar(session, frame, "argocd-projects", "argocd");
      await waitFor(
        "the projects",
        async () => (await countOf(session, frame, TICKS)) >= 1 || undefined,
      );
    }, 90_000);

    const tickAll = async () => {
      const rows = await countOf(session, frame, TICKS);

      for (let index = 0; index < rows; index++) {
        await session.evaluate(
          `document.querySelectorAll(${JSON.stringify(TICKS)})[${index}].click()`,
          frame,
        );
      }

      return rows;
    };

    const confirmation = () =>
      waitFor("the confirmation", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
          frame,
        );

        return text || undefined;
      });

    const cancel = async () => {
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
      await clickWhenShown(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(session, frame, ".ConfirmDialog")) === 0 ? true : undefined,
      );
    };

    it("offers the project actions once projects are ticked", async () => {
      expect(await countOf(session, frame, BAR)).toBe(0);

      const rows = await tickAll();

      const count = await waitFor("the bar", async () => {
        const text = await session.evaluate<string>(
          `document.querySelector(${JSON.stringify(`${BAR} .ArgoCD-selection__count`)})?.textContent ?? ""`,
          frame,
        );

        return text || undefined;
      });

      expect(count).toBe(`${rows} selected`);
      expect(
        await session.evaluate<string[]>(
          `[...document.querySelectorAll(${JSON.stringify(`${BAR} button`)})].map((each) => each.textContent.trim())`,
          frame,
        ),
      ).toEqual(["Refresh all", "Sync all", "Freeze", "Resume"]);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    }, 60_000);

    it("asks for confirm before freezing every ticked project, none frozen yet", async () => {
      const projects = await clusterItems<Project>(session, frame, PROJECTS);

      // The writes suite covers a mix; here every project must be as the seed made it.
      expect(frozenOf(projects), "a project is frozen, from an earlier run").toEqual([]);

      await clickWhenShown(session, frame, `${BAR} button`, "Freeze");

      const dialog = await confirmation();
      const count = projects.length;

      expect(dialog).toContain(`Freeze ${count} project${count === 1 ? "" : "s"}?`);
      expect(dialog).toContain("Type confirm to confirm.");
      expect(dialog).not.toContain("Skipped");
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await cancel();
    }, 60_000);

    it("resumes nothing that is not frozen, and says why", async () => {
      expect(frozenOf(await clusterItems<Project>(session, frame, PROJECTS))).toEqual([]);

      await clickWhenShown(session, frame, `${BAR} button`, "Resume");

      expect(await notificationSaying(session, frame, "Nothing to resume")).toMatch(/not frozen/);
      expect(await countOf(session, frame, ".ConfirmDialog"), "Resume asked about nothing").toBe(0);
    }, 60_000);

    it("offers prune before syncing every Application of the ticked projects", async () => {
      await clickWhenShown(session, frame, `${BAR} button`, "Sync all");

      const dialog = await confirmation();

      expect(dialog).toMatch(/Sync \d+ projects?\?/);
      expect(dialog).toContain("Prune");
      expect(dialog).toContain("Type confirm to confirm.");
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await cancel();
    }, 60_000);

    it("goes away once nothing is ticked", async () => {
      await tickAll();
      await waitFor("the bar to go", async () =>
        (await countOf(session, frame, BAR)) === 0 ? true : undefined,
      );
    }, 30_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
