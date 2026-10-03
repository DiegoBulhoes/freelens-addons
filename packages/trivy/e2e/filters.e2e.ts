import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  openWorkbench,
  textOf,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

// The needle is read from the page: a cluster name would be a fixture that expires.

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
