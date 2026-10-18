import { expect } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickMenuItem,
  clickSidebar,
  clickWhenShown,
  countOf,
  hoverForTooltip,
  shownDrawer,
  waitFor,
} from "../../../../build/e2e/freelens";

interface Workbench {
  session: Session;
  frame: number;
}

export const RULES = "/apis/argocd-image-updater.argoproj.io/v1alpha1/imageupdaters";
export const GROUPS = ["argocd", "argocd-image-updater"];
export const DRAWER = ".ArgoCDObjectDrawer";
/** A drawer title-bar icon, by its Material name. */
// The drawer showing a body: one being replaced stays in the page, emptied, while it slides out.
export const OPEN_DRAWER = shownDrawer(DRAWER);
/** A title-bar icon of the open drawer, by its Material name. */
export const TOOLBAR_ICON = (name: string) =>
  `[...(${OPEN_DRAWER}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => each.textContent.trim() === ${JSON.stringify(name)})`;

export interface Rule {
  metadata: { name: string };
  status?: {
    lastUpdatedAt?: string;
    conditions?: { type: string; status: string }[];
  };
  spec: { applicationRefs: { useAnnotations?: boolean; images?: unknown[] }[] };
}

export const conditionOf = (rule: Rule, type: string) =>
  rule.status?.conditions?.find((condition) => condition.type === type)?.status;

/** Cancels the open dialog once its colours are checked in both themes. */
const cancelMeasuredDialog = (context: () => Workbench) => async () => {
  expect(await dialogColourViolations(context().session, context().frame, "ArgoCD")).toEqual([]);
  await cancelDialog(context().session, context().frame);
};

export function controlsHelpers(context: () => Workbench) {
  const measureAndCancelDialog = cancelMeasuredDialog(context);

  const where = () =>
    context().session.evaluate<string>(
      `location.pathname.replace('/extension/freelens-addons--argocd', '') + location.search`,
      context().frame,
    );

  const openDashboard = async () => {
    await clickSidebar(context().session, context().frame, "argocd-dashboard", "argocd");
    await waitFor(
      "the overview",
      async () =>
        (await countOf(context().session, context().frame, ".ArgoCD-card")) > 0 || undefined,
    );
  };

  const typedFields = () =>
    countOf(context().session, context().frame, '.ConfirmDialog input[aria-label="Confirmation"]');

  /** Menu labels ending in an ellipsis; there should be none. */
  const ellipses = () =>
    context().session.evaluate<string[]>(
      `[...document.querySelectorAll('.MenuItem .title')]
         .map((each) => each.textContent.trim())
         .filter((label) => /(\\.\\.\\.|…)$/.test(label))`,
      context().frame,
    );

  return { where, openDashboard, measureAndCancelDialog, typedFields, ellipses };
}

export function imageUpdaterHelpers(context: () => Workbench & { rules: Rule[] }) {
  const measureAndCancelDialog = cancelMeasuredDialog(context);

  const open = async (page: string, ready: string) => {
    await clickSidebar(context().session, context().frame, page, GROUPS);
    await waitFor(`${page} to render`, async () =>
      (await countOf(context().session, context().frame, ready)) > 0 ? true : undefined,
    );
  };

  /** The first cell after the checkbox of each body row in a section's table, or each row's name in a list. */
  const rowsIn = (section: string) =>
    context().session.evaluate<string[]>(
      `[
        ...[...document.querySelectorAll('[data-section="${section}"] tbody tr')].map((row) => row.querySelector("td:not(.ArgoCD-table__check)")),
        ...document.querySelectorAll('[data-section="${section}"] .ArgoCD-row__name b'),
      ].map((cell) => cell.textContent.split(" · ")[0].trim())`,
      context().frame,
    );

  const drawerText = () =>
    context().session.evaluate<string>(
      `document.querySelector(${JSON.stringify(DRAWER)})?.textContent ?? ""`,
      context().frame,
    );

  /** Opens the ⋮ menu of the first row in a section that has one, and picks `item`. */
  const fromRowMenu = async (section: string, item: string) => {
    await context().session.evaluate(
      `document.querySelector('[data-section="${section}"] .ArgoCD-table__actions i.Icon')?.click()`,
      context().frame,
    );
    await clickMenuItem(context().session, context().frame, item);
  };

  /** Opens a row's drawer by clicking its second cell (the first is a checkbox where rows tick), in the row whose text has `having`. */
  const openFromRow = async (section: string, drawer: string, having = "") => {
    const clicked = await context().session.evaluate<boolean>(
      `(() => {
        const row = [...document.querySelectorAll('[data-section="${section}"] tbody tr')]
          .find((each) => each.textContent.includes(${JSON.stringify(having)}));
        const cell = row?.querySelector("td:nth-child(2)");
        if (!cell) return false;
        cell.click();
        return true;
      })()`,
      context().frame,
    );

    expect(clicked, `${section} has no row with ${having}`).toBe(true);

    return waitFor(`the ${drawer} drawer`, async () =>
      (await countOf(context().session, context().frame, `${DRAWER} [data-section="${drawer}"]`)) >
      0
        ? await drawerText()
        : undefined,
    );
  };

  const closeDrawer = async (drawer = "image-updater-rule") => {
    await context().session.evaluate(`${TOOLBAR_ICON("close")}?.click()`, context().frame);
    await waitFor("the drawer to close", async () =>
      (await countOf(
        context().session,
        context().frame,
        `${DRAWER} [data-section="${drawer}"]`,
      )) === 0
        ? true
        : undefined,
    );
  };

  /** Each title-bar icon is there and its tooltip says what it does. */
  const expectTitleBar = async (icons: [icon: string, says: RegExp][]) => {
    for (const [icon, says] of icons) {
      expect(
        await context().session.evaluate<boolean>(
          `Boolean(${TOOLBAR_ICON(icon)})`,
          context().frame,
        ),
      ).toBe(true);

      await context().session.evaluate(
        `${TOOLBAR_ICON(icon)}.setAttribute("data-hovered", "")`,
        context().frame,
      );
      expect(
        await hoverForTooltip(context().session, context().frame, `${DRAWER} [data-hovered]`),
      ).toMatch(says);
      // Leave it, or its open tooltip is the one read for the next icon.
      await context().session.evaluate(
        `(() => {
          const icon = document.querySelector(${JSON.stringify(`${DRAWER} [data-hovered]`)});
          for (const type of ["pointerleave", "pointerout", "mouseleave", "mouseout"]) {
            icon?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
          }
          icon?.removeAttribute("data-hovered");
        })()`,
        context().frame,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  };

  /** A rule with images of its own (not annotations) that has updated one. */
  const updatedRule = () =>
    context().rules.find(
      (rule) =>
        rule.status?.lastUpdatedAt &&
        rule.spec.applicationRefs.some((ref) => !ref.useAnnotations && ref.images?.length),
    )?.metadata.name ?? "";

  /** Presses a button, expects a confirmation that says `says`, and cancels it. */
  const confirmThenCancel = async (selector: string, label: string, says: RegExp) => {
    await clickWhenShown(context().session, context().frame, selector, label);

    const dialog = await waitFor(`the ${label} confirmation`, async () => {
      const text = await context().session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        context().frame,
      );

      return text || undefined;
    });

    expect(dialog).toMatch(says);
    expect(await dialogColourViolations(context().session, context().frame, "ArgoCD")).toEqual([]);

    await measureAndCancelDialog();
  };

  return {
    open,
    rowsIn,
    drawerText,
    fromRowMenu,
    measureAndCancelDialog,
    openFromRow,
    closeDrawer,
    expectTitleBar,
    updatedRule,
    confirmThenCancel,
  };
}
