import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  countOf,
  type ErrorLog,
  openWorkbench,
  textOf,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { column, EMPTY, openWorkloads, ROW, SEARCH } from "../support/workloads";

// The needle is read from the page: a cluster name would be a fixture that expires.

describe("searching the Trivy workload list", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    await openWorkloads(session, frame);
  }, 180_000);

  afterAll(() => session?.close());

  it("narrows the list to a name that is on it", async () => {
    const total = await countOf(session, frame, ROW);
    const [name] = await column(session, frame, "Workload");

    expect(name, "no workload name to search for").toBeTruthy();

    await typeInto(session, frame, SEARCH, name as string);

    const remaining = await waitFor("the list to narrow", async () => {
      const rows = await countOf(session, frame, ROW);

      return rows > 0 && rows <= total ? rows : undefined;
    });

    expect(remaining).toBeLessThanOrEqual(total);

    // A name may match through its namespace or kind instead, so check every cell of the row.
    const shown = await session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(ROW)})].map((row) => row.textContent)`,
      frame,
    );

    for (const row of shown) expect(row.toLowerCase()).toContain((name as string).toLowerCase());
  });

  it("says so rather than showing a stale list when nothing matches", async () => {
    await typeInto(session, frame, SEARCH, "no-workload-is-called-this");

    const note = await waitFor("the empty note", async () => {
      const text = await textOf(session, frame, EMPTY);

      return text.length > 0 ? text : undefined;
    });

    expect(note).toMatch(/Nothing matches/i);
    expect(await countOf(session, frame, ROW)).toBe(0);
  });

  it("brings the list back when the field is cleared", async () => {
    await typeInto(session, frame, SEARCH, "");

    const restored = await waitFor("the list to come back", async () => {
      const rows = await countOf(session, frame, ROW);

      return rows > 0 ? rows : undefined;
    });

    expect(restored).toBeGreaterThan(0);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
