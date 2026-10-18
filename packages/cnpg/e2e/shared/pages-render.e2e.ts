import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  type ErrorLog,
  openWorkbench,
  proxyFetch,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";

// Counts are "more than none": a number would be the dev cluster's contents.

const PAGES: { id: string; headline: RegExp; rows: string }[] = [
  {
    id: "cnpg-overview",
    headline: /\d+ of \d+ Postgres clusters need attention|ready and backed up/,
    rows: ".CNPG-row",
  },
  {
    id: "cnpg-clusters",
    headline: /^Postgres clusters/,
    rows: '[data-section="cnpg-clusters"] tbody tr',
  },
  { id: "cnpg-backups", headline: /^Backups/, rows: '[data-section="cnpg-backups"] tbody tr' },
  {
    id: "cnpg-schedules",
    headline: /^Scheduled backups/,
    rows: '[data-section="cnpg-schedules"] tbody tr',
  },
  { id: "cnpg-poolers", headline: /^Poolers/, rows: '[data-section="cnpg-poolers"] tbody tr' },
  {
    id: "cnpg-logical",
    headline: /^Logical replication/,
    rows: '[data-section="cnpg-logical"] tbody tr',
  },
];

describe("every page the CloudNativePG extension registers renders", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  /** Barman's last error in the log of the instance that took the schedule's newest Backup. */
  const backupCause = async (schedule: string) => {
    const [newest] = (
      await clusterItems<{
        metadata: { namespace: string; creationTimestamp: string };
        status?: { instanceID?: { podName?: string } };
      }>(
        session,
        frame,
        `/apis/postgresql.cnpg.io/v1/backups?labelSelector=${encodeURIComponent(`cnpg.io/scheduled-backup=${schedule}`)}`,
      )
    ).sort((a, b) => b.metadata.creationTimestamp.localeCompare(a.metadata.creationTimestamp));
    const pod = newest?.status?.instanceID?.podName;

    expect(pod, `the instance that took ${schedule}'s last backup`).toBeTruthy();

    const { body } = await proxyFetch(
      session,
      frame,
      `/api/v1/namespaces/${newest?.metadata.namespace}/pods/${pod}/log?container=plugin-barman-cloud&tailLines=300`,
    );
    const errors = body
      .split("\n")
      .flatMap((line) => {
        try {
          return [String((JSON.parse(line) as { msg?: unknown }).msg ?? "")];
        } catch {
          return [];
        }
      })
      .filter((message) => message.includes("ERROR:"));
    const last = errors.at(-1) ?? "";

    expect(last, `an ERROR line in ${pod}'s barman log`).not.toBe("");

    return last.slice(last.indexOf("ERROR:") + "ERROR:".length).trim();
  };

  for (const page of PAGES) {
    it(`opens ${page.id}, with rows`, async () => {
      await clickSidebar(session, frame, page.id, "cnpg");

      const rows = await waitFor(`rows on ${page.id}`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(page.rows)}).length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(rows).toBeGreaterThan(0);
      expect(await textOf(session, frame, ".CNPG-page__headline")).toMatch(page.headline);
    }, 60_000);
  }

  it("lists each cluster's ready instances and primary, without a column of its replicas", async () => {
    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");

    const headers = await session.evaluate<string[]>(
      `[...document.querySelectorAll('[data-section="cnpg-clusters"] th')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(headers).toEqual(expect.arrayContaining(["Instances", "Primary"]));
    expect(headers).not.toContain("Replicas");
  }, 60_000);

  // Each is a state the seed produces on purpose; a unit test alone would only see a variant.
  it.each([
    ["cnpg-schedules", "legacy-nightly", "Cluster missing"],
    ["cnpg-poolers", "reports-rw", "Cluster unavailable"],
    ["cnpg-clusters", "audit-db", "No backup yet"],
    ["cnpg-clusters", "orders-replica-db", "Replica cluster"],
    ["cnpg-clusters", "orders-replica-db", "replica of orders-db"],
  ])(
    "shows on %s the seeded %s as %s",
    async (page, name, state) => {
      await clickSidebar(session, frame, page, "cnpg");

      const row = await waitFor(`${name}'s row`, async () => {
        const text = await session.evaluate<string>(
          `[...document.querySelectorAll('[data-section="${page}"] tbody tr')].find((each) => [...each.querySelectorAll("td")].some((cell) => cell.textContent.startsWith(${JSON.stringify(name)})))?.textContent ?? ""`,
          frame,
        );

        return text || undefined;
      });

      expect(row).toContain(state);
    },
    60_000,
  );

  it.each([
    ["analytics-db", "Cluster", "Not ready", ""],
    ["legacy-rw", "Pooler", "Cluster missing", ""],
    ["legacy-nightly", "ScheduledBackup", "Cluster missing", ""],
    ["legacy-pub", "Publication", "Not applied", ""],
    ["billing-sub", "Subscription", "Not applied", ""],
    ["orders-db", "Cluster", "Replay paused", "orders-db-3: "],
  ])(
    "lists the seeded %s (%s) as %s among what needs attention",
    async (name, kind, state, reason) => {
      await clickSidebar(session, frame, "cnpg-overview", "cnpg");

      const found = await waitFor(`${name}'s ${state} row`, async () => {
        const hit = await session.evaluate<boolean>(
          `[...document.querySelectorAll('[data-section="cnpg-attention"] .CNPG-row')].some((row) =>
            row.querySelector(".CNPG-row__name b")?.textContent === ${JSON.stringify(name)} &&
            row.querySelector(".CNPG-row__meta")?.textContent.startsWith(${JSON.stringify(`${kind} · `)}) &&
            row.querySelector(".CNPG-row__state")?.textContent === ${JSON.stringify(state)} &&
            (row.querySelector(".CNPG-row__reason")?.textContent ?? "").startsWith(${JSON.stringify(reason)}))`,
          frame,
        );

        return hit || undefined;
      });

      expect(found).toBe(true);
    },
    60_000,
  );

  it("shows each pooler's ready pods against those it wants", async () => {
    await clickSidebar(session, frame, "cnpg-poolers", "cnpg");

    const ready = await waitFor("orders-rw's Ready cell", async () => {
      const text = await session.evaluate<string>(
        `(() => {
          const headers = [...document.querySelectorAll('[data-section="cnpg-poolers"] th')].map((each) => each.textContent.trim());
          const row = [...document.querySelectorAll('[data-section="cnpg-poolers"] tbody tr')].find((each) => each.textContent.startsWith("orders-rw"));
          return row?.children[headers.indexOf("Ready")]?.textContent.trim() ?? "";
        })()`,
        frame,
      );

      return /^\d+\/\d+$/.test(text) ? text : undefined;
    });
    const [up, wanted] = ready.split("/").map(Number);

    expect(wanted).toBeGreaterThan(0);
    expect(up).toBe(wanted);
  }, 60_000);

  it("says when each schedule runs and how soon the next run is", async () => {
    await clickSidebar(session, frame, "cnpg-schedules", "cnpg");

    const cells = await waitFor("orders-hourly's row", async () => {
      const found = await session.evaluate<{ when: string; next: string; title: string }>(
        `(() => {
          const headers = [...document.querySelectorAll('[data-section="cnpg-schedules"] th')].map((each) => each.textContent.trim());
          const row = [...document.querySelectorAll('[data-section="cnpg-schedules"] tbody tr')].find((each) => each.textContent.startsWith("orders-hourly"));
          const next = row?.children[headers.indexOf("Next run")];
          return {
            when: row?.children[headers.indexOf("When")]?.textContent.trim() ?? "",
            next: next?.textContent.trim() ?? "",
            title: next?.querySelector("[title]")?.getAttribute("title") ?? next?.getAttribute("title") ?? "",
          };
        })()`,
        frame,
      );

      return found.when && found.next ? found : undefined;
    });

    expect(cells.when).toBe("Every hour");
    expect(cells.next).toMatch(/^(in \d+[mhd]|due)$/);
    expect(Number.isNaN(Date.parse(cells.title))).toBe(false);
  }, 60_000);

  it("says why archiving fails, in barman's words rather than an exit status", async () => {
    await clickSidebar(session, frame, "cnpg-overview", "cnpg");

    const row = await waitFor("a failing row with its cause", async () => {
      const text = await session.evaluate<string>(
        `[...document.querySelectorAll('.CNPG-row')].find((each) => each.textContent.includes("Archiving failing") && each.textContent.includes("Cause:"))?.textContent ?? ""`,
        frame,
      );

      return text || undefined;
    });
    const cause = row.slice(row.indexOf("Cause:") + "Cause:".length).trim();

    expect(cause.length).toBeGreaterThan(0);
    expect(cause).not.toMatch(/exit status/);

    await clickSidebar(session, frame, "cnpg-schedules", "cnpg");

    const failing = await waitFor("the failing schedule", async () => {
      const name = await session.evaluate<string>(
        `[...document.querySelectorAll('[data-section="cnpg-schedules"] tbody tr')].find((each) => each.textContent.includes("Last run failed"))?.querySelector("td:not(.CNPG-table__check)")?.firstChild?.textContent ?? ""`,
        frame,
      );

      return name || undefined;
    });
    // A backup fails in the log of the instance that took it, often a standby, not the primary.
    const ownCause = await backupCause(failing);

    expect(ownCause).not.toMatch(/exit status/);

    const cell = await waitFor("the failing schedule's cause", async () => {
      const text = await session.evaluate<string>(
        `[...document.querySelectorAll('[data-section="cnpg-schedules"] tbody tr')].find((each) => each.textContent.includes("Last run failed"))?.textContent ?? ""`,
        frame,
      );

      return text.includes(ownCause) ? text : undefined;
    });

    expect(cell).toContain(ownCause);
  }, 60_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
