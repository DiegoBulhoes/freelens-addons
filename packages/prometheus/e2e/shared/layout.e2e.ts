import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  type ErrorLog,
  openWorkbench,
  overflowsSideways,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  GROUP,
  INSTANCES,
  MONITORS,
  NODE_CHARTS,
  PODS,
  RULES,
  rowsOf,
  USAGE_GROUP,
  untilLive,
} from "../support/lists";

// `live`: the page reads Prometheus and Events, whose answers change its rows' text and width.
const PAGES: [id: string, group: string | string[], ready: string, live: boolean][] = [
  ["prometheus-overview", GROUP, ".Prometheus-card", true],
  ["prometheus-monitors", GROUP, rowsOf(MONITORS), true],
  ["prometheus-rules", GROUP, rowsOf(RULES), true],
  ["prometheus-instances", GROUP, rowsOf(INSTANCES), true],
  ["prometheus-usage-nodes", USAGE_GROUP, ".Prometheus-chart", false],
  ["prometheus-usage-pods", USAGE_GROUP, rowsOf(PODS), false],
];

describe("how the Prometheus pages are laid out", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  it.each(PAGES)(
    "builds %s from the design standard, within its width",
    async (id, group, ready, live) => {
      await clickSidebar(session, frame, id, group);
      await waitFor(`${id} to render`, async () =>
        (await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(ready)}).length`,
          frame,
        )) > 0
          ? true
          : undefined,
      );

      if (live) await untilLive(session, frame, ready);

      // The Usage figures land after the rows and widen the cells, so their width counts only then.
      await waitFor(`${id}'s figures`, async () => {
        const subline = await session.evaluate<string>(
          `document.querySelector(".Prometheus-page__subline")?.textContent ?? ""`,
          frame,
        );

        return subline.includes("Asking now.") ? undefined : true;
      });

      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
      expect(await overflowsSideways(session, frame, ".Prometheus-page")).toBeLessThanOrEqual(0);
    },
    90_000,
  );

  it("keeps the four Nodes charts within the page, each with a height", async () => {
    await clickSidebar(session, frame, "prometheus-usage-nodes", USAGE_GROUP);

    const boxes = await waitFor("the four node charts", async () => {
      const found = await session.evaluate<{ left: number; right: number; height: number }[]>(
        `[...document.querySelectorAll('${NODE_CHARTS} .Prometheus-chart__canvas')]
           .map((each) => { const box = each.getBoundingClientRect(); return { left: box.left, right: box.right, height: box.height }; })`,
        frame,
      );

      return found.length === 4 ? found : undefined;
    });
    const page = await session.evaluate<{ left: number; right: number }>(
      `(() => { const box = document.querySelector(".Prometheus-page").getBoundingClientRect(); return { left: box.left, right: box.right }; })()`,
      frame,
    );

    for (const box of boxes) {
      expect(box.height).toBeGreaterThan(0);
      expect(box.left).toBeGreaterThanOrEqual(page.left);
      expect(box.right).toBeLessThanOrEqual(page.right);
    }
  }, 90_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
