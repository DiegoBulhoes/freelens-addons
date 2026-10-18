import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  sidebarItems,
  waitFor,
} from "../../../../build/e2e/freelens";
import { conditionOf, GROUPS, imageUpdaterHelpers, RULES, type Rule } from "../support/argocd";

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

  const { open, rowsIn, drawerText, confirmThenCancel } = imageUpdaterHelpers(() => ({
    session,
    frame,
    rules,
  }));

  it("puts its four screens under Image Updater in the sidebar", async () => {
    await clickSidebar(session, frame, "image-updater-overview", GROUPS);

    const items = await sidebarItems(session, frame);

    for (const id of ["overview", "rules", "images", "updates"]) {
      expect(
        items.some((item) => item.endsWith(`-image-updater-${id}`)),
        `the sidebar has no image-updater-${id}`,
      ).toBe(true);
    }
  }, 60_000);

  describe("the overview", () => {
    beforeAll(() => open("image-updater-overview", ".ArgoCD-card"), 60_000);

    it("singles out every rule whose checks fail, Ready=True or not", async () => {
      const failing = rules
        .filter(
          (rule) => conditionOf(rule, "Error") === "True" || conditionOf(rule, "Ready") === "False",
        )
        .map((rule) => rule.metadata.name);

      expect(failing.length, "the development cluster seeds failing rules").toBeGreaterThan(0);
      expect(await rowsIn("image-updater-attention")).toEqual(expect.arrayContaining(failing));
    });

    it.each([
      ["Need attention", "image-updater-rules", "image-updater-rule-filters"],
      ["Images watched", "image-updater-images", "image-updater-image-filters"],
    ])(
      "opens %s on the filter it counts with, so the rows match the number",
      async (label, list, chips) => {
        await open("image-updater-overview", ".ArgoCD-card");

        const counted = await session.evaluate<number>(
          `(() => {
            const card = [...document.querySelectorAll("button.ArgoCD-card")]
              .find((each) => each.querySelector(".ArgoCD-card__label")?.textContent.trim() === ${JSON.stringify(label)});
            if (!card) return -1;
            const value = Number(card.querySelector(".ArgoCD-card__value")?.textContent);
            card.click();
            return value;
          })()`,
          frame,
        );

        expect(counted, `no card labelled ${label}`).toBeGreaterThan(0);

        const shown = await waitFor(`the ${list} rows`, async () => {
          const pressed = await countOf(
            session,
            frame,
            `[data-section="${chips}"] .ArgoCD-filter[aria-pressed="true"]:not(:first-child)`,
          );
          const rows = await countOf(session, frame, `[data-section="${list}"] tbody tr`);

          return pressed === 1 && rows > 0 ? rows : undefined;
        });

        expect(shown).toBe(counted);
      },
      60_000,
    );

    it("asks before restarting the controller, or refuses while a rule would stop it", async () => {
      await open("image-updater-overview", ".ArgoCD-card");
      const refused = rules.some((rule) => conditionOf(rule, "Ready") === "False");

      if (refused) {
        await clickWhenShown(session, frame, ".ArgoCD-page__actions button", "Check now");
        expect(await notificationSaying(session, frame, "Not restarted")).toMatch(/crash-looping/);
      } else {
        await confirmThenCancel(".ArgoCD-page__actions button", "Check now", /checks every rule/);
      }
    }, 60_000);

    it("opens a rule from its row", async () => {
      const [first] = await rowsIn("image-updater-attention");

      expect(first, "nothing needs attention").toBeDefined();

      await clickWhenShown(
        session,
        frame,
        '[data-section="image-updater-attention"] .ArgoCD-row',
        first as string,
      );
      await waitFor("the drawer", async () =>
        (await drawerText()).includes(first as string) ? true : undefined,
      );
    }, 60_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
