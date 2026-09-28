import type { Session } from "../../../build/e2e/cdp";
import { clickSidebar, waitFor } from "../../../build/e2e/freelens";

/**
 * Opens Workloads on a workload the scanner judged and found something in.
 *
 * The picker lists what was never looked at first, and the development cluster
 * keeps one such workload on purpose, so its first row has no report, no table
 * and no views. A test about the detail's views picks a scanned row instead of
 * relying on what sorts first.
 */
export async function openScannedWorkload(session: Session, frame: number): Promise<string> {
  await clickSidebar(session, frame, "trivy-workloads", "trivy");
  await waitFor(
    "the picker",
    async () =>
      (await session.evaluate<number>(
        "document.querySelectorAll('.Trivy-picker__item').length",
        frame,
      )) > 0 || undefined,
  );

  const name = await session.evaluate<string>(
    `(() => {
      const row = [...document.querySelectorAll('.Trivy-picker__item')].find(
        (each) => /· scanned$/.test(each.querySelector('.Trivy-picker__meta')?.textContent.trim() ?? '')
          && each.querySelector('.Trivy-picker__aside'),
      );
      row?.click();
      return row?.querySelector('.Trivy-picker__name')?.textContent.trim() ?? '';
    })()`,
    frame,
  );

  if (name === "") throw new Error("no scanned workload with findings in the picker");

  await waitFor(
    "its findings",
    async () =>
      (await session.evaluate<number>(
        "document.querySelectorAll('.Trivy-picker__detail .Trivy-table').length",
        frame,
      )) > 0 || undefined,
  );

  return name;
}
