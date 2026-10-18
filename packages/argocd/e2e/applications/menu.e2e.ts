import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickMenuItem,
  clickSidebar,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  openMenu,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { controlsHelpers } from "../support/argocd";

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

  const { measureAndCancelDialog, typedFields } = controlsHelpers(() => ({ session, frame }));

  describe("an Application's own menu", () => {
    const APPLICATIONS = "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications";

    const openRowMenu = async (name: string) => {
      await clickSidebar(session, frame, "argocd-applications", "argocd");
      await waitFor("the Applications", async () =>
        (await countOf(session, frame, ".ArgoCDApplications .TableRow")) > 1 ? true : undefined,
      );

      const opened = await session.evaluate<boolean>(
        `(() => {
          const row = [...document.querySelectorAll(".ArgoCDApplications .TableRow")]
            .find((each) => [...each.querySelectorAll(".TableCell")].some((cell) => cell.textContent.trim() === ${JSON.stringify(name)}));
          const kebab = row?.querySelector(".TableCell.menu i.Icon");
          kebab?.click();
          return Boolean(kebab);
        })()`,
        frame,
      );

      expect(opened, `no menu on ${name}'s row`).toBe(true);
      await openMenu(session, frame);
    };

    const titles = () =>
      session.evaluate<string[]>(
        "[...document.querySelectorAll('.MenuItem .title')].map((each) => each.textContent.trim())",
        frame,
      );

    const automatedOf = async (name: string) =>
      JSON.stringify(
        (
          await clusterItems<{ metadata: { name: string }; spec: { syncPolicy?: unknown } }>(
            session,
            frame,
            APPLICATIONS,
          )
        ).find((each) => each.metadata.name === name)?.spec.syncPolicy,
      );

    it("puts the writes after Pin, with roll back last", async () => {
      await openRowMenu("guestbook");

      const items = await titles();
      const pin = items.findIndex((each) => each === "Pin to the top" || each === "Unpin");
      const sync = items.indexOf("Sync");
      const rollbacks = items.flatMap((each, at) => (each.startsWith("Roll back") ? [at] : []));

      expect(pin, items.join(" | ")).toBeGreaterThan(items.indexOf("Copy status summary"));
      expect(sync, items.join(" | ")).toBeGreaterThan(pin);
      expect(rollbacks.length, "guestbook offers no rollback").toBeGreaterThan(0);
      expect(rollbacks[0]).toBeGreaterThan(sync);
      // The host appends its own Edit and Delete after every extension's items.
      expect(items.slice(-2), items.join(" | ")).toEqual(["Edit", "Delete"]);
      expect(rollbacks.at(-1)).toBe(items.length - 3);
      await session.evaluate(
        "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
        frame,
      );
    }, 60_000);

    it("asks before a refresh from the menu, without a typed word", async () => {
      await openRowMenu("guestbook");
      await session.evaluate(
        `[...document.querySelectorAll('.MenuItem')].find((each) => each.querySelector('.title')?.textContent.trim() === "Refresh")?.click()`,
        frame,
      );

      const dialog = await dialogText(session, frame);

      expect(dialog).toContain("Refresh guestbook?");
      expect(dialog).toContain("Nothing in the cluster changes.");
      expect(await typedFields()).toBe(0);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
      await measureAndCancelDialog();
    }, 60_000);

    it("says a rollback turns auto-sync off and how to put it back, and changes nothing when cancelled", async () => {
      const before = await automatedOf("guestbook");

      await openRowMenu("guestbook");
      await clickMenuItem(session, frame, "Roll back to");

      const dialog = await dialogText(session, frame);

      expect(dialog).toMatch(/Roll guestbook back to deploy #\d+ \(/);
      expect(dialog).toContain("This also turns off its automated sync with self-heal");
      expect(dialog).toContain("Resume auto-sync");
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
      await measureAndCancelDialog();
      expect(await automatedOf("guestbook"), "cancelling still wrote").toBe(before);
    }, 60_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
