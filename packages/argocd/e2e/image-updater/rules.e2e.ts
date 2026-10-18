import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickWhenShown,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, imageUpdaterHelpers, RULES, type Rule, TOOLBAR_ICON } from "../support/argocd";

// Read-only: writing actions are cancelled at their confirmation, or delete is confirmed with a wrong name.

describe("the Image Updater screens", () => {
  let session: Session;
  let frame: number;
  let rules: Rule[];
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    rules = await clusterItems<Rule>(session, frame, RULES);
  }, 180_000);

  afterAll(() => session?.close());

  const { open, rowsIn, drawerText, expectTitleBar, updatedRule, confirmThenCancel } =
    imageUpdaterHelpers(() => ({ session, frame, rules }));

  describe("a rule that has updated an image, from the rules", () => {
    let name: string;

    beforeAll(async () => {
      await open("image-updater-rules", "[data-section='image-updater-rules'] tbody tr");

      name = updatedRule();
      expect(name, "the development cluster seeds a rule that updated").not.toBe("");

      const clicked = await session.evaluate<boolean>(
        `(() => {
          const row = [...document.querySelectorAll('[data-section="image-updater-rules"] tbody tr')]
            .find((each) => each.querySelector("td:not(.ArgoCD-table__check)").textContent.split(" · ")[0].trim() === ${JSON.stringify(name)});
          if (!row) return false;
          row.click();
          return true;
        })()`,
        frame,
      );

      expect(clicked, `no row for ${name}`).toBe(true);
      await waitFor(`${name}'s drawer`, async () =>
        (await drawerText()).includes(name) ? true : undefined,
      );
    }, 90_000);

    it("lists every rule the cluster has", async () => {
      expect((await rowsIn("image-updater-rules")).sort()).toEqual(
        rules.map((rule) => rule.metadata.name).sort(),
      );
    });

    it("shows its last update, its images and the commands to look further", async () => {
      const text = await drawerText();

      expect(text).toMatch(/→/);
      expect(
        await countOf(
          session,
          frame,
          `${DRAWER} [data-section="image-updater-images"] .ArgoCD-box`,
        ),
      ).toBeGreaterThan(0);
      expect(text).toContain(`imageUpdater_name=${name}`);
    });

    it("builds the drawer from the design standard", async () => {
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    });

    it("asks before undoing, and whether to pin the old tag or skip the new one", async () => {
      await confirmThenCancel(`${DRAWER} button`, "Undo", /Pin to .*Skip .* only/);
    }, 60_000);

    it("puts the rule's own actions in the title bar, each with a tooltip", async () => {
      await expectTitleBar([
        ["subject", /controller's log/],
        ["delete", /Deletes the rule/],
      ]);

      expect(
        await session.evaluate<boolean>(
          `[...document.querySelectorAll('${DRAWER} [data-section="image-updater-rule"] button')].some((each) => each.textContent.includes("Delete"))`,
          frame,
        ),
        "Delete is an icon in the title bar, not a button in the body",
      ).toBe(false);
    }, 60_000);

    it("asks for the rule's name before deleting it, and deletes nothing for another word", async () => {
      await session.evaluate(`${TOOLBAR_ICON("delete")}.click()`, frame);

      const dialog = await dialogText(session, frame);

      expect(dialog).toMatch(new RegExp(`Type ${name} to confirm`));
      expect(await countOf(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]')).toBe(
        1,
      );
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
      await clickWhenShown(session, frame, ".ConfirmDialog button", "Delete");

      expect(await notificationSaying(session, frame, "Nothing was changed")).toContain(name);

      const after = await clusterItems<Rule>(session, frame, RULES);

      expect(after.map((rule) => rule.metadata.name)).toContain(name);
    }, 60_000);

    it("copies a command", async () => {
      await clickWhenShown(
        session,
        frame,
        `${DRAWER} [data-section="image-updater-commands"] button`,
        "Copy",
      );
      expect(await notificationSaying(session, frame, "copied")).toMatch(/copied/);
    }, 60_000);

    it("takes a watched image to its Application, whose drawer names the rule", async () => {
      const chip = await session.evaluate<string>(
        `(() => {
          const chip = [...document.querySelectorAll(${JSON.stringify(`${DRAWER} button.ArgoCD-chip`)})]
            .find((each) => !each.textContent.includes("skipped"));
          if (!chip) return "";
          const name = chip.querySelector("span").textContent;
          chip.click();
          return name;
        })()`,
        frame,
      );

      expect(chip, "no watched image reaches an Application").not.toBe("");

      await waitFor("the Applications list narrowed to it", async () =>
        (await countOf(session, frame, ".ArgoCDApplications .TableRow")) === 1 ? true : undefined,
      );

      // The link names one Application, so its drawer opens without a click; a click would close it.
      const drawer = await waitFor("the drawer's Image Updater section", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.Drawer')?.textContent ?? ''",
          frame,
        );

        return text.includes("Image Updater") ? text : undefined;
      });

      expect(drawer).toContain(name);

      await clickWhenShown(session, frame, ".Drawer .ArgoCDApplicationDetails .ArgoCD-link", name);
      await waitFor("the rule's own drawer", async () =>
        (await drawerText()).includes(name) &&
        (await countOf(session, frame, `${DRAWER} [data-section="image-updater-rule"]`)) > 0
          ? true
          : undefined,
      );
    }, 90_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
