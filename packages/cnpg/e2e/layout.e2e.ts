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
  ["cnpg-overview", ".CNPG-row"],
  ["cnpg-clusters", '[data-section="cnpg-clusters"] tbody tr'],
  ["cnpg-backups", '[data-section="cnpg-backups"] tbody tr'],
  ["cnpg-schedules", '[data-section="cnpg-schedules"] tbody tr'],
  ["cnpg-poolers", '[data-section="cnpg-poolers"] tbody tr'],
  ["cnpg-logical", '[data-section="cnpg-logical"] tbody tr'],
];

describe("how the CloudNativePG pages are laid out", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const open = async (id: string, ready: string) => {
    await clickSidebar(session, frame, id, "cnpg");
    await waitFor(`${id} to render`, async () =>
      (await session.evaluate<number>(
        `document.querySelectorAll(${JSON.stringify(ready)}).length`,
        frame,
      )) > 0
        ? true
        : undefined,
    );
  };

  it.each(PAGES)(
    "builds %s from the design standard, within its width",
    async (id, ready) => {
      await open(id, ready);

      expect(await designViolations(session, frame, "CNPG")).toEqual([]);
      expect(await overflowsSideways(session, frame, ".CNPG-page")).toBeLessThanOrEqual(0);
    },
    90_000,
  );
});
