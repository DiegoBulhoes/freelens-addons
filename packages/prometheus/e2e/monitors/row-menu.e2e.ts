import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickMenuItem,
  countOf,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, LISTS, MONITORS, openList, rowNamed } from "../support/lists";

describe("the controls on the Prometheus pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  describe("a row's menu", () => {
    const openMenu = async (key: string) => {
      await openList(session, frame, LISTS.monitors);
      await waitFor(`${key}'s row`, () =>
        session.evaluate<boolean>(`Boolean(${rowNamed(MONITORS, key)})`, frame),
      );
      await session.evaluate(
        `${rowNamed(MONITORS, key)}.querySelector(".Prometheus-table__actions i.Icon").click()`,
        frame,
      );
      await waitFor(
        "the menu",
        async () => (await countOf(session, frame, ".MenuItem")) || undefined,
      );
    };

    it("copies orphan's fix YAML, closes, and opens no drawer", async () => {
      await openMenu("prom-apps/orphan");
      expect(
        await session.evaluate<string[]>(
          `[...document.querySelectorAll(".MenuItem .title")].map((each) => each.textContent.trim()).filter((each) => each.startsWith("Copy fix YAML"))`,
          frame,
        ),
      ).toEqual([
        "Copy fix YAML: Labels to join Prometheus monitoring/seed",
        "Copy fix YAML: Labels to join TargetAllocator of otel-collectors/scraper",
      ]);
      await clickMenuItem(session, frame, "Copy fix YAML");

      expect(await notificationSaying(session, frame, "Fix YAML copied")).toBeTruthy();
      expect(
        await waitFor(
          "the menu to close",
          async () => ((await countOf(session, frame, ".MenuItem")) === 0 ? true : undefined),
          // The host's close animation is under a second; longer means it stayed open.
          5_000,
        ),
      ).toBe(true);
      expect(await countOf(session, frame, `${DRAWER} [data-section]`)).toBe(0);
    }, 60_000);

    it("offers no fix for prom-self, which is healthy", async () => {
      await openMenu("monitoring/prom-self");

      const item = await session.evaluate<string>(
        `[...document.querySelectorAll(".MenuItem")].find((each) => each.textContent.includes("Copy fix YAML"))?.className ?? ""`,
        frame,
      );

      expect(item).toMatch(/disabled/);
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
