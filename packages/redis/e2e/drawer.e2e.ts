import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  drawerTitle,
  hoverForTooltip,
  openDrawer,
  openWorkbench,
  waitFor,
} from "../../../build/e2e/freelens";

// Read-only: every dialog is opened and cancelled; the objects are compared before and after.

const DRAWER = ".RedisObjectDrawer";
const PATH = "/apis/redis.redis.opstreelabs.in/v1beta2/redisreplications";

describe("a Redis drawer", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const toolbarIcon = (name: string) =>
    `[...(${openDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(name)})`;

  const specs = async () =>
    JSON.stringify(
      (await clusterItems<{ metadata: { name: string }; spec: unknown }>(session, frame, PATH))
        .map((each) => [each.metadata.name, each.spec])
        .sort(),
    );

  const openRow = async (page: string, name: string, kind: string) => {
    await clickSidebar(session, frame, `redis-${page}`, "redis");
    await waitFor("rows", async () =>
      (await countOf(`[data-section="redis-${page}"] tbody tr`)) > 0 ? true : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="redis-${page}"] tbody tr')].find((row) => row.children[1]?.textContent.startsWith(${JSON.stringify(name)}))?.querySelector("td:nth-child(2)").click()`,
      frame,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await drawerTitle(session, frame, DRAWER)) === `${kind}: ${name}` &&
      (await countOf(`${DRAWER} [data-section="redis-nodes"]`)) > 0
        ? true
        : undefined,
    );
  };

  const dialogText = () =>
    waitFor(
      "the confirmation",
      async () =>
        (await session.evaluate<string>(
          "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
          frame,
        )) || undefined,
    );

  const cancelDialog = async () => {
    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
  };

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
    expect(await countOf(`${DRAWER} .Redis-copyable button`)).toBeGreaterThan(0);
    expect(await designViolations(session, frame, "Redis")).toEqual([]);
  }, 90_000);

  it("says who issued a standalone's TLS certificate", async () => {
    await openRow("standalones", "sessions", "Standalone");

    const tls = await session.evaluate<string>(
      `(() => { const terms = [...document.querySelectorAll('${DRAWER} .Redis-facts dt')]; return terms.find((each) => each.textContent === "TLS")?.nextElementSibling?.textContent ?? ""; })()`,
      frame,
    );

    expect(tls).toMatch(/issued by cert-manager/);
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

      expect(await dialogText(), icon).toMatch(question);
      expect(await dialogColourViolations(session, frame, "Redis"), icon).toEqual([]);

      await cancelDialog();
    }

    await clickByText(
      session,
      frame,
      `${DRAWER} [data-section="redis-nodes"] button`,
      "Restart all",
    );
    expect(await dialogText()).toMatch(
      /In order: restart cache-\d, then restart cache-\d, then restart cache-\d\./,
    );
    await cancelDialog();

    expect(await specs()).toEqual(before);
  }, 120_000);

  it("offers no restart for a cluster, and says why", async () => {
    await openRow("clusters", "shards", "Cluster");

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
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", "Restart");
    await dialogText();

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
    expect(await countOf(`${DRAWER} [data-section="redis-nodes"]`)).toBeGreaterThan(0);

    await cancelDialog();
  }, 60_000);
});
