import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickMenuItem,
  clickWhenShown,
  countOf,
  dialogText,
  drawerTitle,
  type ErrorLog,
  hoverForTooltip,
  leaveNothingBehind,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, redisDrawer } from "../support/redis";

// Read-only: every dialog is opened and cancelled; the objects are compared before and after.

describe("a Redis drawer", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterEach(() => leaveNothingBehind(session, frame, "redis-overview", "redis"));

  afterAll(() => session?.close());

  const { toolbarIcon, specs, openRow } = redisDrawer(() => ({ session, frame }));

  it("opens a replication with its master, its sentinel and a copyable connection", async () => {
    await openRow("replications", "cache", "Replication");

    const terms = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} .Redis-facts dt')].map((each) => each.textContent)`,
      frame,
    );

    expect(terms).toEqual(
      expect.arrayContaining(["Master", "Sentinels", "TLS", "Master (read-write)"]),
    );

    const roles = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="redis-nodes"] .Redis-row__state')].map((each) => each.textContent)`,
      frame,
    );

    expect(roles.filter((each) => each === "Master")).toHaveLength(1);
    expect(roles.filter((each) => each === "Replica").length).toBeGreaterThan(0);
    expect(await countOf(session, frame, `${DRAWER} .Redis-copyable button`)).toBeGreaterThan(0);
    expect(await designViolations(session, frame, "Redis")).toEqual([]);
  }, 90_000);

  it("says who issued a standalone's TLS certificate", async () => {
    await openRow("standalones", "sessions", "Standalone");

    const tls = await session.evaluate<string>(
      `(() => { const terms = [...document.querySelectorAll('${DRAWER} .Redis-facts dt')]; return terms.find((each) => each.textContent === "TLS")?.nextElementSibling?.textContent ?? ""; })()`,
      frame,
    );

    expect(tls).toMatch(/issued by cert-manager/);
    expect(await designViolations(session, frame, "Redis")).toEqual([]);
  }, 60_000);

  it("draws a failing replication's drawer to the standard, with its namespace's warnings", async () => {
    await openRow("replications", "broken-cache", "Replication");

    const warning = await waitFor(
      "its warnings",
      async () =>
        (await session.evaluate<string>(
          `document.querySelector('${DRAWER} [data-section="redis-warnings"] .Redis-row--warning')?.textContent ?? ""`,
          frame,
        )) || undefined,
    );

    expect(warning).toMatch(/broken-cache-\d/);
    expect(await designViolations(session, frame, "Redis")).toEqual([]);
  }, 60_000);

  it("links a replication's sentinel to its drawer, and back", async () => {
    await openRow("replications", "cache", "Replication");
    await clickWhenShown(session, frame, `${DRAWER} .Redis-facts .Redis-link`, "cache-sentinel");
    await waitFor("the sentinel's drawer", async () =>
      (await drawerTitle(session, frame, DRAWER)) === "Sentinel: cache-sentinel" ? true : undefined,
    );
    expect(await designViolations(session, frame, "Redis"), "the sentinel's drawer").toEqual([]);
    await clickWhenShown(session, frame, `${DRAWER} .Redis-facts .Redis-link`, "cache");
    await waitFor("the replication's drawer", async () =>
      (await drawerTitle(session, frame, DRAWER)) === "Replication: cache" ? true : undefined,
    );
  }, 60_000);

  it("links each pod's volume and the password Secret to the host's lists", async () => {
    await openRow("replications", "cache", "Replication");

    const titles = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} .Redis-link')].map((each) => each.title)`,
      frame,
    );

    expect(titles.filter((each) => /PersistentVolumeClaims/.test(each))).toHaveLength(3);
    expect(titles.some((each) => /Secrets list/.test(each))).toBe(true);
    expect(
      await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} [data-section="redis-commands"] code')].map((each) => each.textContent)`,
        frame,
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/redis-operator\[:@\]/)]));
  }, 60_000);

  it("links a pod to the host's Pods list, narrowed to it, and closes the drawer", async () => {
    await openRow("replications", "cache", "Replication");

    const clicked = await session.evaluate<boolean>(
      `(() => {
        const link = [...document.querySelectorAll('${DRAWER} [data-section="redis-nodes"] .Redis-link')].find((each) => /Pods list/.test(each.title) && each.textContent === "cache-0");
        link?.click();
        return Boolean(link);
      })()`,
      frame,
    );

    expect(clicked, "no Pods-list link on cache-0").toBe(true);

    const landed = await waitFor("the host's Pods list", async () => {
      const where = await session.evaluate<string>("location.pathname + location.search", frame);

      return where.includes("/pods") ? where : undefined;
    });

    expect(decodeURIComponent(landed)).toContain("search=cache-0");
    expect(await countOf(session, frame, `${DRAWER} [data-section="redis-nodes"]`)).toBe(0);
  }, 60_000);

  it("asks before failing over, scaling and restarting, in the theme's colours, and writes nothing when cancelled", async () => {
    const before = await specs();

    await openRow("replications", "cache", "Replication");

    for (const [icon, question] of [
      ["swap_horiz", /Fail cache over to a replica/],
      ["unfold_more", /Change the size of cache/],
    ] as const) {
      await session.evaluate(`${toolbarIcon(icon)}.setAttribute("data-hovered", "")`, frame);
      expect(await hoverForTooltip(session, frame, `${DRAWER} [data-hovered]`), icon).toMatch(/\w/);
      await session.evaluate(
        `document.querySelector('${DRAWER} [data-hovered]')?.removeAttribute("data-hovered")`,
        frame,
      );
      await session.evaluate(`${toolbarIcon(icon)}.click()`, frame);

      expect(await dialogText(session, frame), icon).toMatch(question);
      expect(await dialogColourViolations(session, frame, "Redis"), icon).toEqual([]);

      await cancelDialog(session, frame);
    }

    await clickWhenShown(
      session,
      frame,
      `${DRAWER} [data-section="redis-nodes"] button`,
      "Restart all",
    );
    expect(await dialogText(session, frame)).toMatch(
      /In order: restart cache-\d, then restart cache-\d, then restart cache-\d\./,
    );
    expect(await dialogColourViolations(session, frame, "Redis"), "Restart all").toEqual([]);
    await cancelDialog(session, frame);

    await session.evaluate(
      `document.querySelector('${DRAWER} [data-section="redis-nodes"] .Redis-row__actions i.Icon').click()`,
      frame,
    );
    await clickMenuItem(session, frame, "Restart");
    expect(await dialogText(session, frame)).toMatch(/cache-0/);
    expect(await dialogColourViolations(session, frame, "Redis"), "Restart a pod").toEqual([]);
    await cancelDialog(session, frame);

    expect(await specs()).toEqual(before);
  }, 120_000);

  it("says what a size would remove while it is typed, before anything is sent", async () => {
    const before = await specs();

    await openRow("replications", "cache", "Replication");
    await session.evaluate(`${toolbarIcon("unfold_more")}.click()`, frame);
    await dialogText(session, frame);
    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Pods"]', "1");

    expect(
      await waitFor(
        "the warning",
        async () =>
          (await session.evaluate<string>(
            `document.querySelector('.ConfirmDialog .Redis-text--warning')?.textContent ?? ""`,
            frame,
          )) || undefined,
      ),
    ).toMatch(/Removes cache-1, cache-2/);
    expect(await dialogColourViolations(session, frame, "Redis")).toEqual([]);

    await cancelDialog(session, frame);
    expect(await specs()).toEqual(before);
  }, 60_000);

  it("offers no restart for a cluster, and says why", async () => {
    await openRow("clusters", "shards", "Cluster");

    expect(
      await countOf(session, frame, '[data-section="redis-clusters"] .Redis-table__check'),
    ).toBe(0);

    const buttons = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="redis-nodes"] button')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(buttons).not.toContain("Restart all");
    expect(
      await session.evaluate<string>(
        `document.querySelector('${DRAWER} [data-section="redis-nodes"] .Redis-hint')?.textContent ?? ""`,
        frame,
      ),
    ).toMatch(/No restart here/);
    expect(
      await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} [data-section="redis-commands"] code')].map((each) => each.textContent)`,
        frame,
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/shards-leader-0 .*cluster nodes/)]));
    expect(await designViolations(session, frame, "Redis")).toEqual([]);

    await session.evaluate(
      `document.querySelector('${DRAWER} [data-section="redis-nodes"] .Redis-row__actions i.Icon').click()`,
      frame,
    );
    const items = await waitFor("the pod's menu", async () => {
      const titles = await session.evaluate<string[]>(
        `[...document.querySelectorAll('.MenuItem .title')].map((each) => each.textContent)`,
        frame,
      );

      return titles.length > 0 ? titles : undefined;
    });

    expect(items).toContain("Log");
    expect(items).not.toContain("Restart");

    await session.evaluate(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`,
      frame,
    );
  }, 60_000);

  it("closes a pod's menu once an item is picked, and keeps the drawer open", async () => {
    await openRow("replications", "cache", "Replication");
    await session.evaluate(
      `document.querySelector('${DRAWER} [data-section="redis-nodes"] .Redis-row__actions i.Icon').click()`,
      frame,
    );
    await clickMenuItem(session, frame, "Restart");
    await dialogText(session, frame);

    expect(
      await waitFor(
        "the menu to close",
        async () =>
          (await session.evaluate<number>(
            `[...document.querySelectorAll('.MenuItem')].filter((each) => !each.closest('${DRAWER}')).length`,
            frame,
          )) === 0
            ? true
            : undefined,
        5_000,
      ),
    ).toBe(true);
    expect(await countOf(session, frame, `${DRAWER} [data-section="redis-nodes"]`)).toBeGreaterThan(
      0,
    );

    await cancelDialog(session, frame);
  }, 60_000);

  it("logs no error in any of that", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
