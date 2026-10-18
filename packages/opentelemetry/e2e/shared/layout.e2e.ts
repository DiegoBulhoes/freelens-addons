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
import { COLLECTOR_ROWS, ROWS } from "../support/lists";

const PAGES: [id: string, ready: string][] = [
  ["opentelemetry-overview", ".OpenTelemetry-row"],
  ["opentelemetry-coverage", ROWS],
  ["opentelemetry-collectors", COLLECTOR_ROWS],
];

describe("how the OpenTelemetry pages are laid out", () => {
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
      await clickSidebar(session, frame, id, "opentelemetry");
      await waitFor(`${id} to render`, async () =>
        (await session.evaluate<number>(
          `document.querySelectorAll(${JSON.stringify(ready)}).length`,
          frame,
        )) > 0
          ? true
          : undefined,
      );

      expect(await designViolations(session, frame, "OpenTelemetry")).toEqual([]);
      expect(await overflowsSideways(session, frame, ".OpenTelemetry-page")).toBeLessThanOrEqual(0);
    },
    90_000,
  );

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
