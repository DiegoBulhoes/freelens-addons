import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  openWorkbench,
  textOf,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

/**
 * The filter field written into the workload picker.
 *
 * Its rules are covered by unit tests and covered well: `selectWorkloads` has
 * fourteen cases. What no unit test can say is whether a keystroke in the
 * rendered page reaches them — the field can be a controlled input whose value
 * never moves, or wired to a state the list does not read — and that half has
 * been broken here before without any suite noticing.
 *
 * The needle is read out of the page rather than written here. A name from the
 * development cluster would be a fixture with an expiry date, and the property
 * under test is "typing a name that is on screen narrows the list to it", which
 * holds whatever the cluster contains.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

const ROW = ".Trivy-picker__item";

describe("the Trivy workload picker filters", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());

    await clickSidebar(session, frame, "trivy-workloads", "trivy");
    await waitFor("the workload list", async () => (await countOf(ROW)) > 0 || undefined);
  }, 180_000);

  afterAll(() => session?.close());

  function countOf(selector: string): Promise<number> {
    return session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );
  }

  it("narrows the list to a name that is on it", async () => {
    const total = await countOf(ROW);
    const name = await textOf(session, frame, `${ROW} .Trivy-picker__name`);

    expect(name.length, "no workload name to filter by").toBeGreaterThan(0);

    await typeInto(session, frame, ".Trivy-search", name);

    const remaining = await waitFor("the list to narrow", async () => {
      const rows = await countOf(ROW);

      return rows > 0 && rows <= total ? rows : undefined;
    });

    expect(remaining).toBeLessThanOrEqual(total);

    const shown = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${ROW} .Trivy-picker__name')].map((e) => e.textContent.trim())`,
      frame,
    );

    // Every row left names the workload typed, which is the filter having run
    // rather than the list happening to be short.
    for (const row of shown) expect(row).toContain(name);
  });

  it("says so rather than showing a stale list when nothing matches", async () => {
    await typeInto(session, frame, ".Trivy-search", "no-workload-is-called-this");

    const note = await waitFor("the empty note", async () => {
      const text = await textOf(session, frame, ".Trivy-picker__empty");

      return text.length > 0 ? text : undefined;
    });

    expect(note).toMatch(/Nothing matches/i);
    expect(await countOf(ROW)).toBe(0);
  });

  it("brings the list back when the field is cleared", async () => {
    await typeInto(session, frame, ".Trivy-search", "");

    const restored = await waitFor("the list to come back", async () => {
      const rows = await countOf(ROW);

      return rows > 0 ? rows : undefined;
    });

    expect(restored).toBeGreaterThan(0);
  });
});
