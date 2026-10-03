import type { Session } from "../../../build/e2e/cdp";
import { clickByText, waitFor } from "../../../build/e2e/freelens";

/** Puts the attention list on All (the filter persists across runs) and returns its row count. */
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
