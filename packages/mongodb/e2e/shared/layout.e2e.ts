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

const PAGES: [id: string, ready: string][] = [
  ["mongodb-overview", ".MongoDB-row"],
  ["mongodb-clusters", '[data-section="mongodb-clusters"] tbody tr'],
];

describe("how the MongoDB pages are laid out", () => {
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
    async (id, ready) => {
      await clickSidebar(session, frame, id, "mongodb");
      await waitFor(`${id} to render`, async () =>
        (await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(ready)}).length`,
          frame,
        )) > 0
          ? true
          : undefined,
      );

      expect(await designViolations(session, frame, "MongoDB")).toEqual([]);
      expect(await overflowsSideways(session, frame, ".MongoDB-page")).toBeLessThanOrEqual(0);
    },
    90_000,
  );

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
