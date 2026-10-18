import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  leaveNothingBehind,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";

// Read-only: each bulk restart is cancelled, refused, or confirmed with the wrong word.

const LIST = '[data-section="redis-replications"]';
const PODS = "/api/v1/namespaces/redis/pods";

describe("ticking several Redis objects", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterEach(() => leaveNothingBehind(session, frame, "redis-overview", "redis"));

  afterAll(() => session?.close());

  const openList = async (page: string) => {
    await clickSidebar(session, frame, `redis-${page}`, "redis");
    await waitFor(`the ${page}`, async () =>
      (await countOf(session, frame, `[data-section="redis-${page}"] tbody tr`)) > 0
        ? true
        : undefined,
    );
  };

  const tick = async (name: string) => {
    const ticked = await session.evaluate<boolean>(
      `(() => {
        const row = [...document.querySelectorAll('${LIST} tbody tr')].find((each) => (each.querySelector("td:not(.Redis-table__check)")?.textContent ?? "").split(" · ")[0] === ${JSON.stringify(name)});
        const box = row?.querySelector(".Redis-table__check input");
        box?.click();
        return Boolean(box);
      })()`,
      frame,
    );

    if (!ticked) throw new Error(`no checkbox for ${name}`);
  };

  const tickAll = () =>
    session.evaluate(
      `document.querySelector('${LIST} thead .Redis-table__check input').click()`,
      frame,
    );

  const uids = async () =>
    (await clusterItems<{ metadata: { uid: string } }>(session, frame, PODS))
      .map((each) => each.metadata.uid)
      .sort();

  it("offers Restart once a row is ticked, without opening a drawer", async () => {
    await openList("replications");
    await tick("cache");

    const labels = await waitFor("the selection bar", async () => {
      const found = await session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="selection"] button')].map((each) => each.textContent.trim())`,
        frame,
      );

      return found.length > 0 ? found : undefined;
    });

    expect(labels).toEqual(["Restart"]);
    expect(await countOf(session, frame, '.RedisObjectDrawer [data-section="redis-nodes"]')).toBe(
      0,
    );
    expect(await designViolations(session, frame, "Redis")).toEqual([]);
  }, 60_000);

  it("offers ticks on every list but Clusters, where each restart would be refused", async () => {
    for (const page of ["replications", "standalones", "sentinels"]) {
      await openList(page);
      expect(
        await countOf(session, frame, `[data-section="redis-${page}"] .Redis-table__check`),
        page,
      ).toBeGreaterThan(0);
    }

    await openList("clusters");
    expect(
      await countOf(session, frame, '[data-section="redis-clusters"] .Redis-table__check'),
    ).toBe(0);
  }, 90_000);

  it("lists the replications a restart reaches, and names the one it skips with why", async () => {
    await openList("replications");
    await tickAll();
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");

    const dialog = await dialogText(session, frame);

    expect(dialog).toMatch(/Restart 1 replication\?/);
    expect(dialog).toMatch(/Skipped: broken-cache \(broken-cache-0, broken-cache-1 are not ready/);
    expect(dialog).toMatch(/Type confirm to confirm/);
    expect(await dialogColourViolations(session, frame, "Redis")).toEqual([]);

    await cancelDialog(session, frame);
  }, 60_000);

  it("refuses outright when every ticked one would be skipped, and opens no dialog", async () => {
    const before = await uids();

    await openList("replications");
    await tick("broken-cache");
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");

    expect(
      await notificationSaying(session, frame, "Nothing to restart: broken-cache: broken-cache-0"),
    ).toMatch(/not ready/);
    expect(await countOf(session, frame, ".ConfirmDialog")).toBe(0);
    expect(await uids()).toEqual(before);
  }, 60_000);

  it("restarts nothing when the wrong word is typed", async () => {
    const before = await uids();

    await openList("replications");
    await tick("cache");
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");

    expect(await dialogText(session, frame)).toMatch(/Restart 1 replication\?/);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await session.evaluate(
      `[...document.querySelectorAll('.ConfirmDialog button')].find((each) => each.textContent.startsWith("Restart"))?.click()`,
      frame,
    );

    expect(await notificationSaying(session, frame, 'Nothing was changed: "confirm"')).toBeTruthy();
    expect(await uids()).toEqual(before);
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
