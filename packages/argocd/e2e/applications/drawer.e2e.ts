import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clusterItems,
  countOf,
  type ErrorLog,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";

// Read-only: each drawer is opened, read against the API and closed.

const APPLICATIONS = "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications";
const DETAILS = ".Drawer .ArgoCDApplicationDetails";

interface ApplicationObject {
  metadata: { name: string };
  spec: { project?: string; source?: unknown; sources?: unknown[] };
  status?: {
    sync?: { status?: string };
    health?: { status?: string };
    conditions?: { type?: string }[];
    resources?: unknown[];
    history?: unknown[];
    operationState?: { phase?: string };
  };
}

// podinfo has two sources, bad-revision a ComparisonError, guestbook neither.
const OPENED = ["podinfo", "bad-revision", "guestbook"];

describe("the Application drawer, read against the cluster", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;
  let applications: ApplicationObject[];

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    applications = await clusterItems<ApplicationObject>(session, frame, APPLICATIONS);
  }, 180_000);

  afterAll(() => session?.close());

  const open = async (name: string) => {
    await clickSidebar(session, frame, "argocd-applications", "argocd");
    await waitFor("the Applications", async () =>
      (await countOf(session, frame, ".ArgoCDApplications .TableRow")) > 1 ? true : undefined,
    );

    const clicked = await session.evaluate<boolean>(
      `(() => {
        const row = [...document.querySelectorAll(".ArgoCDApplications .TableRow")]
          .find((each) => [...each.querySelectorAll(".TableCell")].some((cell) => cell.textContent.trim() === ${JSON.stringify(name)}));
        row?.click();
        return Boolean(row);
      })()`,
      frame,
    );

    expect(clicked, `no row named ${name}`).toBe(true);
    await waitFor(`${name}'s drawer`, async () =>
      (await countOf(session, frame, DETAILS)) > 0 ? true : undefined,
    );
  };

  const close = async () => {
    await session.evaluate(
      `[...document.querySelectorAll(".Drawer .drawer-title i.Icon")].find((each) => each.textContent.trim() === "close")?.click()`,
      frame,
    );
    await waitFor("the drawer to close", async () =>
      (await countOf(session, frame, DETAILS)) === 0 ? true : undefined,
    );
  };

  /** Each DrawerItem as [name, value], in order. */
  const items = () =>
    session.evaluate<[string, string][]>(
      `[...document.querySelectorAll(${JSON.stringify(`${DETAILS} .DrawerItem`)})].map((each) => [
        each.querySelector('.name')?.textContent.trim() ?? '',
        each.querySelector('.value')?.textContent.trim() ?? '',
      ])`,
      frame,
    );

  const titles = () =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(`${DETAILS} .DrawerTitle`)})].map((each) => each.textContent.trim())`,
      frame,
    );

  it.each(OPENED)(
    "draws %s's drawer from what the cluster says of it, to the standard",
    async (name) => {
      const object = applications.find((each) => each.metadata.name === name);

      expect(object, `the seed has no Application ${name}`).toBeDefined();
      if (!object) return;

      await open(name);

      try {
        const facts = new Map(await items());
        const sections = await titles();
        const sources = object.spec.sources?.length || 1;
        const conditions = object.status?.conditions ?? [];
        const resources = object.status?.resources?.length ?? 0;
        const history = object.status?.history?.length ?? 0;

        expect(facts.get("Sync")).toContain(object.status?.sync?.status ?? "Unknown");
        expect(facts.get("Health")).toContain(object.status?.health?.status ?? "Unknown");
        expect(facts.get("Project")).toBe(object.spec.project ?? "default");
        expect(sections).toContain(`Sources (${sources})`);

        expect(sections.includes("Conditions"), "Conditions").toBe(conditions.length > 0);
        for (const condition of conditions) expect([...facts.keys()]).toContain(condition.type);

        if (resources > 0) expect(sections).toContain(`Managed resources (${resources})`);
        else expect(facts.get("Managed resources")).toBe("none reported yet");

        expect(sections.includes("Deploy history"), "Deploy history").toBe(history > 0);
        expect(sections.includes("Last sync"), "Last sync").toBe(
          object.status?.operationState !== undefined,
        );
        if (object.status?.operationState) {
          expect(facts.get("Result")).toBe(object.status.operationState.phase ?? "—");
        }

        // A comparison error is a finding: a banner, not a muted line.
        expect(await countOf(session, frame, `${DETAILS} .ArgoCD-banner`), "banner").toBe(
          conditions.some((each) => each.type === "ComparisonError") ? 1 : 0,
        );
        expect(
          await countOf(session, frame, `${DETAILS} [data-section="application-commands"]`),
        ).toBe(1);
        expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
      } finally {
        await close();
      }
    },
    90_000,
  );

  it("opens every drawer without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
