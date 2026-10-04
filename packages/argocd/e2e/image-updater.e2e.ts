import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  hoverForTooltip,
  notificationSaying,
  openDrawer,
  openWorkbench,
  sidebarItems,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

// Read-only: writing actions are cancelled at their confirmation, or delete is confirmed with a wrong name.

const RULES = "/apis/argocd-image-updater.argoproj.io/v1alpha1/imageupdaters";
const GROUPS = ["argocd", "argocd-image-updater"];
const DRAWER = ".ArgoCDObjectDrawer";
/** A drawer title-bar icon, by its Material name. */
// The drawer showing a body: one being replaced stays in the page, emptied, while it slides out.
const OPEN_DRAWER = openDrawer(DRAWER);
/** A title-bar icon of the open drawer, by its Material name. */
const TOOLBAR_ICON = (name: string) =>
  `[...(${OPEN_DRAWER}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => each.textContent.trim() === ${JSON.stringify(name)})`;

interface Rule {
  metadata: { name: string };
  status?: {
    lastUpdatedAt?: string;
    conditions?: { type: string; status: string }[];
  };
  spec: { applicationRefs: { useAnnotations?: boolean; images?: unknown[] }[] };
}

const conditionOf = (rule: Rule, type: string) =>
  rule.status?.conditions?.find((condition) => condition.type === type)?.status;

describe("the Image Updater screens", () => {
  let session: Session;
  let frame: number;
  let rules: Rule[];

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
    rules = await clusterItems<Rule>(session, frame, RULES);
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const open = async (page: string, ready: string) => {
    await clickSidebar(session, frame, page, GROUPS);
    await waitFor(`${page} to render`, async () => ((await countOf(ready)) > 0 ? true : undefined));
  };

  /** The first cell after the checkbox of each body row in a section's table, or each row's name in a list. */
  const rowsIn = (section: string) =>
    session.evaluate<string[]>(
      `[
        ...[...document.querySelectorAll('[data-section="${section}"] tbody tr')].map((row) => row.querySelector("td:not(.ArgoCD-table__check)")),
        ...document.querySelectorAll('[data-section="${section}"] .ArgoCD-row__name b'),
      ].map((cell) => cell.textContent.split(" · ")[0].trim())`,
      frame,
    );

  const drawerText = () =>
    session.evaluate<string>(
      `document.querySelector(${JSON.stringify(DRAWER)})?.textContent ?? ""`,
      frame,
    );

  /** Opens the ⋮ menu of the first row in a section that has one, and picks `item`. */
  const fromRowMenu = async (section: string, item: string) => {
    await session.evaluate(
      `document.querySelector('[data-section="${section}"] .ArgoCD-table__actions i.Icon')?.click()`,
      frame,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", item);
  };

  const dialogText = () =>
    waitFor("the confirmation", async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text || undefined;
    });

  const cancelDialog = async () => {
    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
  };

  /** Opens a row's drawer by clicking its second cell (the first is a checkbox where rows tick), in the row whose text has `having`. */
  const openFromRow = async (section: string, drawer: string, having = "") => {
    const clicked = await session.evaluate<boolean>(
      `(() => {
        const row = [...document.querySelectorAll('[data-section="${section}"] tbody tr')]
          .find((each) => each.textContent.includes(${JSON.stringify(having)}));
        const cell = row?.querySelector("td:nth-child(2)");
        if (!cell) return false;
        cell.click();
        return true;
      })()`,
      frame,
    );

    expect(clicked, `${section} has no row with ${having}`).toBe(true);

    return waitFor(`the ${drawer} drawer`, async () =>
      (await countOf(`${DRAWER} [data-section="${drawer}"]`)) > 0 ? await drawerText() : undefined,
    );
  };

  const closeDrawer = async (drawer = "image-updater-rule") => {
    await session.evaluate(`${TOOLBAR_ICON("close")}?.click()`, frame);
    await waitFor("the drawer to close", async () =>
      (await countOf(`${DRAWER} [data-section="${drawer}"]`)) === 0 ? true : undefined,
    );
  };

  /** Each title-bar icon is there and its tooltip says what it does. */
  const expectTitleBar = async (icons: [icon: string, says: RegExp][]) => {
    for (const [icon, says] of icons) {
      expect(await session.evaluate<boolean>(`Boolean(${TOOLBAR_ICON(icon)})`, frame)).toBe(true);

      await session.evaluate(`${TOOLBAR_ICON(icon)}.setAttribute("data-hovered", "")`, frame);
      expect(await hoverForTooltip(session, frame, `${DRAWER} [data-hovered]`)).toMatch(says);
      // Leave it, or its open tooltip is the one read for the next icon.
      await session.evaluate(
        `(() => {
          const icon = document.querySelector(${JSON.stringify(`${DRAWER} [data-hovered]`)});
          for (const type of ["pointerleave", "pointerout", "mouseleave", "mouseout"]) {
            icon?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
          }
          icon?.removeAttribute("data-hovered");
        })()`,
        frame,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  };

  /** A rule with images of its own (not annotations) that has updated one. */
  const updatedRule = () =>
    rules.find(
      (rule) =>
        rule.status?.lastUpdatedAt &&
        rule.spec.applicationRefs.some((ref) => !ref.useAnnotations && ref.images?.length),
    )?.metadata.name ?? "";

  /** Presses a button, expects a confirmation that says `says`, and cancels it. */
  const confirmThenCancel = async (selector: string, label: string, says: RegExp) => {
    await clickByText(session, frame, selector, label);

    const dialog = await waitFor(`the ${label} confirmation`, async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text || undefined;
    });

    expect(dialog).toMatch(says);
    expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

    await cancelDialog();
  };

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

    it("asks before restarting the controller, or refuses while a rule would stop it", async () => {
      const refused = rules.some((rule) => conditionOf(rule, "Ready") === "False");

      if (refused) {
        await clickByText(session, frame, ".ArgoCD-page__actions button", "Check now");
        expect(await notificationSaying(session, frame, "Not restarted")).toMatch(/crash-looping/);
      } else {
        await confirmThenCancel(".ArgoCD-page__actions button", "Check now", /checks every rule/);
      }
    }, 60_000);

    it("opens a rule from its row", async () => {
      const [first] = await rowsIn("image-updater-attention");

      expect(first, "nothing needs attention").toBeDefined();

      await clickByText(
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
        await countOf(`${DRAWER} [data-section="image-updater-images"] .ArgoCD-box`),
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

      const dialog = await dialogText();

      expect(dialog).toMatch(new RegExp(`Type ${name} to confirm`));
      expect(await countOf('.ConfirmDialog input[aria-label="Confirmation"]')).toBe(1);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
      await clickByText(session, frame, ".ConfirmDialog button", "Delete");

      expect(await notificationSaying(session, frame, "Nothing was changed")).toContain(name);

      const after = await clusterItems<Rule>(session, frame, RULES);

      expect(after.map((rule) => rule.metadata.name)).toContain(name);
    }, 60_000);

    it("copies a command", async () => {
      await clickByText(
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
        (await countOf(".ArgoCDApplications .TableRow")) === 1 ? true : undefined,
      );

      await session.evaluate(
        "document.querySelector('.ArgoCDApplications .TableRow').click()",
        frame,
      );

      const drawer = await waitFor("the drawer's Image Updater section", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.Drawer')?.textContent ?? ''",
          frame,
        );

        return text.includes("Image Updater") ? text : undefined;
      });

      expect(drawer).toContain(name);
    }, 90_000);
  });

  describe("ticking rules", () => {
    const SECTION = "image-updater-rules";
    const BAR = '[data-section="selection"]';

    beforeAll(() => open(SECTION, `[data-section='${SECTION}'] tbody tr`), 60_000);

    /** Ticks the first `count` rows by their own checkbox, as a person would. */
    const tick = (count: number) =>
      session.evaluate(
        `[...document.querySelectorAll('[data-section="${SECTION}"] tbody .ArgoCD-table__check input')].slice(0, ${count}).forEach((box) => box.click())`,
        frame,
      );

    it("ticks a rule without opening its drawer, and offers Delete in the bar", async () => {
      expect(await countOf(BAR)).toBe(0);

      await tick(2);

      const bar = await waitFor("the selection bar", async () => {
        const text = await session.evaluate<string>(
          `document.querySelector(${JSON.stringify(BAR)})?.textContent ?? ""`,
          frame,
        );

        return text || undefined;
      });

      expect(bar).toMatch(/2 selected/);
      expect(
        await session.evaluate<string[]>(
          `[...document.querySelectorAll(${JSON.stringify(`${BAR} button`)})].map((each) => each.textContent.trim())`,
          frame,
        ),
      ).toEqual(["Delete"]);
      expect(await countOf(`[data-section="${SECTION}"] tbody .ArgoCD-table__row--selected`)).toBe(
        2,
      );
      expect(await countOf(`${DRAWER} [data-section="image-updater-rule"]`)).toBe(0);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    }, 60_000);

    it("deletes no rule when the wrong word is typed", async () => {
      await clickByText(session, frame, `${BAR} button`, "Delete");

      const dialog = await dialogText();

      expect(dialog).toMatch(/Delete 2 rules\?/);
      expect(dialog).toContain("Type confirm to confirm.");
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
      await clickByText(session, frame, ".ConfirmDialog button", "Delete 2");

      expect(
        await notificationSaying(session, frame, 'Nothing was changed: "confirm"'),
      ).toBeTruthy();

      const after = await clusterItems<Rule>(session, frame, RULES);

      expect(after.map((rule) => rule.metadata.name).sort()).toEqual(
        rules.map((rule) => rule.metadata.name).sort(),
      );
    }, 60_000);

    it("goes away once nothing is ticked", async () => {
      await tick(2);
      await waitFor("the bar to go", async () => ((await countOf(BAR)) === 0 ? true : undefined));
    }, 30_000);
  });

  describe("the images", () => {
    beforeAll(
      () => open("image-updater-images", "[data-section='image-updater-images'] tbody tr"),
      60_000,
    );

    it("opens the edit form with the image's own settings", async () => {
      await fromRowMenu("image-updater-images", "Edit");

      await waitFor("the edit form", async () =>
        (await countOf('.ConfirmDialog input[aria-label="Version constraint"]')) > 0
          ? true
          : undefined,
      );

      expect(await countOf('.ConfirmDialog .ArgoCD-filter[aria-pressed="true"]')).toBe(1);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
      );
    }, 60_000);

    it("counts its rows in the head, and narrows them by search", async () => {
      const all = await countOf('[data-section="image-updater-images"] tbody tr');
      const count = await session.evaluate<string>(
        "document.querySelector('.ArgoCD-page__count')?.textContent ?? ''",
        frame,
      );

      expect(count).toBe(`${all} item${all === 1 ? "" : "s"}`);

      await typeInto(
        session,
        frame,
        ".ArgoCD-page__actions .ArgoCD-search",
        "no-image-is-called-this",
      );
      await waitFor("the search to narrow the list", async () =>
        (await countOf('[data-section="image-updater-images"] tbody tr')) === 0 ? true : undefined,
      );
      expect(
        await session.evaluate<string>(
          "document.querySelector('.ArgoCD-page__count')?.textContent ?? ''",
          frame,
        ),
      ).toBe(`0 of ${all} item${all === 1 ? "" : "s"}`);

      await typeInto(session, frame, ".ArgoCD-page__actions .ArgoCD-search", "");
      await waitFor("the list to come back", async () =>
        (await countOf('[data-section="image-updater-images"] tbody tr')) === all
          ? true
          : undefined,
      );
    }, 60_000);

    it("sorts by a header, and says so on it", async () => {
      const sortBy = (column: string) =>
        clickByText(
          session,
          frame,
          '[data-section="image-updater-images"] th .ArgoCD-sort',
          column,
        );
      const sortState = () =>
        session.evaluate<string>(
          `[...document.querySelectorAll('[data-section="image-updater-images"] th')].find((each) => each.textContent.trim() === "Rule")?.getAttribute("aria-sort") ?? ""`,
          frame,
        );

      expect(await sortState()).toBe("none");
      await sortBy("Rule");
      expect(await sortState()).toBe("ascending");
      await sortBy("Rule");
      expect(await sortState()).toBe("descending");
      await sortBy("Rule");
      expect(await sortState()).toBe("none");
    }, 60_000);

    it("opens the image from its row: how a tag is picked, where it is written, what it reaches", async () => {
      const text = await openFromRow("image-updater-images", "image-updater-image", updatedRule());

      expect(text).toMatch(/Image: /);
      for (const fact of [
        "Repository",
        "Strategy",
        "Constraint",
        "Allowed tags",
        "Writes to",
        "Settings in",
        "Rule",
      ]) {
        expect(text).toContain(fact);
      }
      expect(
        await countOf(`${DRAWER} [data-section="image-updater-image-applications"] .ArgoCD-row`),
      ).toBeGreaterThan(0);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    }, 60_000);

    it("puts Edit in the image's title bar, and asks before saving", async () => {
      await expectTitleBar([["edit", /constraint, the strategy and the allowed tags/]]);

      await session.evaluate(`${TOOLBAR_ICON("edit")}.click()`, frame);
      await waitFor("the edit form", async () =>
        (await countOf('.ConfirmDialog input[aria-label="Version constraint"]')) > 0
          ? true
          : undefined,
      );
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
      await cancelDialog();
    }, 60_000);

    it("opens the image's rule from its link", async () => {
      await clickByText(
        session,
        frame,
        `${DRAWER} [data-section="image-updater-image"] .ArgoCD-facts button.ArgoCD-link`,
        updatedRule(),
      );
      await waitFor("the rule's drawer", async () =>
        (await countOf(`${DRAWER} [data-section="image-updater-rule"]`)) > 0 ? true : undefined,
      );
      expect(await countOf(`${DRAWER} [data-section="image-updater-image"]`)).toBe(0);
      await closeDrawer();
    }, 60_000);

    it("keeps every row one line high, as the host's lists do", async () => {
      const heights = await session.evaluate<number[]>(
        `[...document.querySelectorAll('[data-section="image-updater-images"] tbody tr')].map((row) => Math.round(row.getBoundingClientRect().height))`,
        frame,
      );

      expect(new Set(heights).size, `rows of ${heights.join(", ")}px`).toBe(1);
    });

    it("holds text in its cells, not chips or buttons", async () => {
      expect(
        await countOf(
          '[data-section="image-updater-images"] tbody :is(.ArgoCD-chip, .ArgoCD-button)',
        ),
      ).toBe(0);
    });
  });

  describe("the updates", () => {
    beforeAll(
      () => open("image-updater-updates", "[data-section='image-updater-updates'] tbody tr"),
      60_000,
    );

    it("shows a row for each rule that has updated", async () => {
      const updated = rules.filter((rule) => rule.status?.lastUpdatedAt).length;

      expect(
        await countOf('[data-section="image-updater-updates"] tbody tr'),
      ).toBeGreaterThanOrEqual(updated);
    });

    it("opens the update from its row: from and to, when, its Applications and its rule", async () => {
      const text = await openFromRow("image-updater-updates", "image-updater-update");

      expect(text).toMatch(/Image update: .+ → /);
      for (const fact of ["From", "To", "When", "Applications updated", "Rule"]) {
        expect(text).toContain(fact);
      }
      expect(
        await countOf(`${DRAWER} [data-section="image-updater-update-applications"] .ArgoCD-row`),
      ).toBeGreaterThan(0);
      expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
    }, 60_000);

    it("puts Undo in the update's title bar, and asks first", async () => {
      await expectTitleBar([["undo", /previous tag back/]]);

      await session.evaluate(`${TOOLBAR_ICON("undo")}.click()`, frame);

      const dialog = await waitFor("the Undo confirmation or its refusal", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent || document.querySelector('.Notifications')?.textContent || ''",
          frame,
        );

        return text || undefined;
      });

      if ((await countOf(".ConfirmDialog")) > 0) {
        expect(dialog).toMatch(/Pin to/);
        expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);
        await cancelDialog();
      } else {
        expect(dialog).toMatch(/Cannot undo from here/);
      }
    }, 60_000);

    it("opens the update's rule from its link", async () => {
      await session.evaluate(
        `document.querySelector(${JSON.stringify(`${DRAWER} [data-section="image-updater-update"] .ArgoCD-facts button.ArgoCD-link`)}).click()`,
        frame,
      );
      await waitFor("the rule's drawer", async () =>
        (await countOf(`${DRAWER} [data-section="image-updater-rule"]`)) > 0 ? true : undefined,
      );
      await closeDrawer();
    }, 60_000);

    it("asks before undoing from the row's menu too", async () => {
      await fromRowMenu("image-updater-updates", "Undo");

      const dialog = await waitFor("the Undo confirmation", async () => {
        const text = await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
          frame,
        );

        return text || undefined;
      });

      expect(dialog).toMatch(/Pin to/);
      expect(await dialogColourViolations(session, frame, "ArgoCD")).toEqual([]);

      await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
      await waitFor("the dialog to close", async () =>
        (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
      );
    }, 60_000);

    it("keeps every row one line high, as the host's lists do", async () => {
      const heights = await session.evaluate<number[]>(
        `[...document.querySelectorAll('[data-section="image-updater-updates"] tbody tr')].map((row) => Math.round(row.getBoundingClientRect().height))`,
        frame,
      );

      expect(new Set(heights).size, `rows of ${heights.join(", ")}px`).toBe(1);
    });
  });
});
