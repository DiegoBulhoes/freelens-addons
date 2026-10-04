import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations } from "../../../build/e2e/design";
import {
  clickSidebar,
  openWorkbench,
  overflowsSideways,
  waitFor,
} from "../../../build/e2e/freelens";

const PAGES: [id: string, ready: string][] = [
  ["redis-overview", ".Redis-row"],
  ["redis-replications", '[data-section="redis-replications"] tbody tr'],
  ["redis-clusters", '[data-section="redis-clusters"] tbody tr'],
  ["redis-standalones", '[data-section="redis-standalones"] tbody tr'],
  ["redis-sentinels", '[data-section="redis-sentinels"] tbody tr'],
];

describe("how the Redis pages are laid out", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  it.each(PAGES)(
    "builds %s from the design standard, within its width",
    async (id, ready) => {
      await clickSidebar(session, frame, id, "redis");
      await waitFor(`${id} to render`, async () =>
        (await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(ready)}).length`,
          frame,
        )) > 0
          ? true
          : undefined,
      );

      expect(await designViolations(session, frame, "Redis")).toEqual([]);
      expect(await overflowsSideways(session, frame, ".Redis-page")).toBeLessThanOrEqual(0);
    },
    90_000,
  );
});
