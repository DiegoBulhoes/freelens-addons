import { expect } from "vitest";

import {
  clickSidebar,
  countOf,
  shownDrawer,
  textOf,
  type Workbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  cellOf,
  chooseInFilter,
  DRAWER,
  filterSays,
  GROUP,
  LISTS,
  NODE_FILTER,
  PODS,
  RANGE_DIALOG,
  rowsOf,
  USAGE_GROUP,
  WINDOW,
  windowSays,
} from "./lists";

type At = () => Pick<Workbench, "session" | "frame">;

export const MONITOR = '[data-section="prometheus-monitor"]';
export const RULE = '[data-section="prometheus-rule"]';
export const INSTANCE = '[data-section="prometheus-instance"]';
export const LIVE_BOX = `${DRAWER} [data-section="prometheus-monitor-live"] .Prometheus-box`;

export const METRIC_CHIPS = '[data-section="prometheus-usage-pod-metric"] .Prometheus-filter';
export const REFRESH = ".Prometheus-page__actions .Prometheus-button";
export const SUBLINE = ".Prometheus-page__subline";
export const START = `${RANGE_DIALOG} input[aria-label="Start of the range"]`;
export const END = `${RANGE_DIALOG} input[aria-label="End of the range"]`;
export const RANGE_ERROR = '[data-section="prometheus-usage-range-error"]';
// "used of total · percent", as describeShare writes it.
export const SHARE = / of .+ · \d+%$/;
export const CORES = /^\d+(\.\d+)?m? of \d+(\.\d+)?m? · \d+%$/;

// The suites assign session and frame in beforeAll, so the readers take them at call time.
export function drawerReads(at: At) {
  const texts = (selector: string) => {
    const { session, frame } = at();

    return session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].map((each) => each.textContent.trim())`,
      frame,
    );
  };

  const toolbarIcons = (name: string) =>
    `[...(${shownDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].filter((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(name)})`;

  const toolbarIcon = (name: string) => `${toolbarIcons(name)}[0]`;

  const where = () => {
    const { session, frame } = at();

    return session.evaluate<string>(
      "decodeURIComponent(location.pathname + location.search)",
      frame,
    );
  };

  /** The term's value in the drawer's facts; "" when it has none. */
  const factOf = (term: string) => {
    const { session, frame } = at();

    return session.evaluate<string>(
      `[...document.querySelectorAll('${DRAWER} .Prometheus-facts dt')].find((each) => each.textContent.trim() === ${JSON.stringify(term)})?.nextElementSibling?.textContent.trim() ?? ""`,
      frame,
    );
  };

  const mutedReason = (section: string, matching: RegExp) =>
    waitFor(
      `the reason matching ${matching}`,
      async () => {
        const { session, frame } = at();
        const text = await textOf(session, frame, `${DRAWER} ${section} > .Prometheus-muted`);

        return matching.test(text) ? text : undefined;
      },
      90_000,
    );

  /** The live read lands after the drawer opens; wait for the state the seed declares. */
  const bannerSaying = (label: string) =>
    waitFor(
      `the ${label} banner`,
      async () => {
        const { session, frame } = at();
        const title = await textOf(session, frame, `${DRAWER} .Prometheus-banner__title`);

        return title === label ? title : undefined;
      },
      90_000,
    );

  return { texts, toolbarIcons, toolbarIcon, where, factOf, mutedReason, bannerSaying };
}

export function controlReads(at: At) {
  const where = () => {
    const { session, frame } = at();

    return session.evaluate<string>(
      "location.pathname.replace(/^\\/extension\\/[^/]+/, '') + location.search",
      frame,
    );
  };

  const states = (section: string) => {
    const { session, frame } = at();

    return session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(`${rowsOf(section)} .Prometheus-status`)})].map((each) => each.textContent.trim())`,
      frame,
    );
  };

  const rowTexts = (rows: string) => {
    const { session, frame } = at();

    return session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(rows)})].map((each) => each.textContent)`,
      frame,
    );
  };

  const openOverview = async () => {
    const { session, frame } = at();

    await clickSidebar(session, frame, "prometheus-overview", GROUP);
    await waitFor(
      "the cards",
      async () => (await countOf(session, frame, "button.Prometheus-card")) > 0 || undefined,
    );
  };

  const pressCard = async (label: string) => {
    const { session, frame } = at();
    const { value, title } = await session.evaluate<{ value: number; title: string }>(
      `(() => {
        const card = [...document.querySelectorAll('button.Prometheus-card')]
          .find((each) => each.querySelector('.Prometheus-card__label')?.textContent.trim() === ${JSON.stringify(label)});
        if (!card) return { value: -1, title: "" };
        card.click();
        return { value: Number(card.querySelector('.Prometheus-card__value').textContent), title: card.title };
      })()`,
      frame,
    );

    if (value < 0) throw new Error(`no card labelled ${label}`);

    return { value, title };
  };

  return { where, states, rowTexts, openOverview, pressCard };
}

export function usageReads(at: At) {
  // Refresh stays enabled and is aria-busy while a read is out.
  const refreshReady = () => {
    const { session, frame } = at();

    return session.evaluate<boolean>(
      `(() => {
        const button = document.querySelector(${JSON.stringify(REFRESH)});
        return Boolean(button) && !button.disabled && button.getAttribute("aria-busy") !== "true";
      })()`,
      frame,
    );
  };

  /** The pod whose name starts with this, in this namespace; its generated suffix varies. */
  const podStarting = (namespace: string, prefix: string) =>
    waitFor(`a ${prefix} pod`, async () => {
      const { session, frame } = at();
      const found = await session.evaluate<string>(
        `(() => {
          const heads = [...document.querySelectorAll(${JSON.stringify(`${PODS} thead th`)})].map((each) => each.textContent.trim());
          const cell = (row, title) => row.children[heads.indexOf(title)]?.textContent.trim() ?? "";
          const row = [...document.querySelectorAll(${JSON.stringify(rowsOf(PODS))})]
            .find((each) => cell(each, "Namespace") === ${JSON.stringify(namespace)} && cell(each, "Name").startsWith(${JSON.stringify(prefix)}));
          return row ? cell(row, "Name") : "";
        })()`,
        frame,
      );

      return found || undefined;
    });

  /** Waits for a cell to hold a figure: the metrics land after the list. */
  const untilCell = (section: string, key: string, title: string, shape: RegExp) =>
    waitFor(
      `${key}'s ${title}`,
      async () => {
        const { session, frame } = at();
        const text = await cellOf(session, frame, section, key, title);

        return shape.test(text) ? text : undefined;
      },
      120_000,
    );

  return { refreshReady, podStarting, untilCell };
}

// The window and the chosen nodes outlive the page, so a run must not start on a leftover choice.
export async function resetUsage(session: Workbench["session"], frame: number) {
  await clickSidebar(session, frame, LISTS.nodes.page, USAGE_GROUP);
  await waitFor("the usage filters", async () =>
    (await session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(NODE_FILTER)}).length`,
      frame,
    )) > 0
      ? true
      : undefined,
  );
  await chooseInFilter(session, frame, WINDOW, "1 hour");
  await chooseInFilter(session, frame, NODE_FILTER, "All nodes");
  expect(await windowSays(session, frame)).toBe("1 hour");
  expect(await filterSays(session, frame, NODE_FILTER)).toBe("All nodes");
}
