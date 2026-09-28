import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { clickSidebar, openWorkbench, typeInto, waitFor } from "../../../build/e2e/freelens";
import { showAllAttention } from "./attention";

/**
 * The filter field written into the attention list.
 *
 * Its rules are covered by unit tests and covered well: `getAttentionItems` and
 * `attention-filter.ts` have dozens of cases between them. What no unit test can
 * say is whether a keystroke in the rendered page reaches them — the field can be
 * a controlled input whose value never moves, or wired to a state the list does
 * not read — and that half has been broken in this repository before without any
 * suite noticing.
 *
 * This one filters by absence rather than by a name read off the page. The
 * attention list holds only what needs attention, which on a healthy cluster is
 * one row or none, so narrowing it to a name proves less than emptying it does.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

// The attention list's rows only: "Syncing repeatedly" uses the same component
// and is not filtered.
const ROW = '[data-section="attention"] .ArgoCD-row';

describe("the ArgoCD attention list filters", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());

    await clickSidebar(session, frame, "argocd-dashboard", "argocd");
    await showAllAttention(session, frame);
  }, 180_000);

  afterAll(() => session?.close());

  function rowCount(): Promise<number> {
    return session.evaluate<number>(`document.querySelectorAll('${ROW}').length`, frame);
  }

  it("empties the list for a name no Application has", async () => {
    const total = await rowCount();

    expect(total, "nothing needs attention, so there is no filter to test").toBeGreaterThan(0);

    await typeInto(session, frame, ".ArgoCD-search", "no-application-is-called-this");

    const emptied = await waitFor("the list to empty", async () =>
      (await rowCount()) === 0 ? true : undefined,
    );

    expect(emptied).toBe(true);
  });

  it("brings the list back when the field is cleared", async () => {
    await typeInto(session, frame, ".ArgoCD-search", "");

    const restored = await waitFor("the list to come back", async () => {
      const rows = await rowCount();

      return rows > 0 ? rows : undefined;
    });

    expect(restored).toBeGreaterThan(0);
  });
});
