import type { Session } from "../../../build/e2e/cdp";
import { clickByText, waitFor } from "../../../build/e2e/freelens";

/**
 * Puts the attention list on All and waits for its rows; returns how many.
 *
 * Only the attention list's rows: "Syncing repeatedly" below it uses the same row,
 * and neither filter nor search applies there.
 *
 * The dashboard remembers its filter across restarts, so a suite that opens it
 * reads whatever filter the last run left pressed — and one whose rows have
 * since drained, a Progressing Application that settled, shows an empty list.
 * A test that needs the rows asks for all of them instead of inheriting that.
 */
export async function showAllAttention(session: Session, frame: number): Promise<number> {
  const count = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  await waitFor(
    "the attention filters",
    async () => (await count(".ArgoCD-filter")) > 0 || undefined,
  );
  await clickByText(session, frame, ".ArgoCD-filter", "All");

  return waitFor("the attention list", async () => {
    const rows = await count('[data-section="attention"] .ArgoCD-row');

    return rows > 0 ? rows : undefined;
  });
}
