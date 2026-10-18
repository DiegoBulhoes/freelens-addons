import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  type ErrorLog,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER } from "../support/cnpg";

describe("opening a row of each list", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  it("follows a row's cluster link to the cluster, without opening the row", async () => {
    await clickSidebar(session, frame, "cnpg-poolers", "cnpg");
    await waitFor("the poolers", async () =>
      (await countOf(session, frame, '[data-section="cnpg-poolers"] tbody tr')) > 0
        ? true
        : undefined,
    );
    await session.evaluate(
      `document.querySelector('[data-section="cnpg-poolers"] tbody tr .CNPG-link').click()`,
      frame,
    );

    expect(
      await waitFor("the clusters list", async () =>
        (await countOf(session, frame, '[data-section="cnpg-clusters"]')) > 0 ? true : undefined,
      ),
    ).toBe(true);
    expect(await countOf(session, frame, `${DRAWER} [data-section="cnpg-pooler"]`)).toBe(0);
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
