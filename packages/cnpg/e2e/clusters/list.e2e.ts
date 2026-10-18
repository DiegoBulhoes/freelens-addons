import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  type ErrorLog,
  leaveNothingBehind,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { type ClusterItem, replicatedCluster } from "../support/cnpg";

describe("a replicated cluster, in detail", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;
  let cluster: ClusterItem;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    cluster = await replicatedCluster(session, frame);
  }, 180_000);

  afterAll(() => session?.close());
  // A failed test leaves no dialog, drawer or ticks to the next.
  afterEach(() => leaveNothingBehind(session, frame, "cnpg-overview", "cnpg"));

  it("shows each cluster's worst replica lag in the list", async () => {
    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");

    const lag = await waitFor("the lag column filled", async () => {
      const text = await session.evaluate<string>(
        `(() => {
          const headers = [...document.querySelectorAll('[data-section="cnpg-clusters"] th')].map((each) => each.textContent.trim());
          const row = [...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr')].find((each) => each.textContent.startsWith(${JSON.stringify(cluster.metadata.name)}));
          return row?.children[headers.indexOf("Lag")]?.textContent ?? "";
        })()`,
        frame,
      );

      return /\d+(\.\d)? (B|kB|MB|GB)/.test(text) ? text : undefined;
    });

    expect(lag).toMatch(/B$/);
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
