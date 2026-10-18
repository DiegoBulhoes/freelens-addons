import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clusterItems,
  countOf,
  drawerTitle,
  type ErrorLog,
  openWorkbench,
  shownDrawer,
  waitFor,
} from "../../../../build/e2e/freelens";

// Read-only: the page has no writes; each drawer is opened, read against the API and closed.

const SETS = "/apis/argoproj.io/v1alpha1/applicationsets";
const APPLICATIONS = "/apis/argoproj.io/v1alpha1/applications";
const PAGE = "argocd-application-sets";
const LIST = "[data-section='application-sets']";
const DRAWER = ".ArgoCDObjectDrawer";
const OPEN_DRAWER = shownDrawer(DRAWER);
const DETAILS = ".Drawer .ArgoCDApplicationDetails";

interface SetObject {
  metadata: { name: string; namespace: string; uid: string };
  spec: { generators?: Record<string, unknown>[] };
  status?: { conditions?: { type: string; status: string; reason?: string }[] };
}

interface ApplicationObject {
  metadata: { name: string; namespace: string; ownerReferences?: { kind: string; uid: string }[] };
}

describe("the ApplicationSets page, read against the cluster", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;
  let sets: SetObject[];
  let applications: ApplicationObject[];

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    sets = await clusterItems<SetObject>(session, frame, SETS);
    applications = await clusterItems<ApplicationObject>(session, frame, APPLICATIONS);
  }, 180_000);

  afterAll(() => session?.close());

  const ownedBy = (set: SetObject) =>
    applications
      .filter((each) =>
        each.metadata.ownerReferences?.some(
          (ref) => ref.kind === "ApplicationSet" && ref.uid === set.metadata.uid,
        ),
      )
      .map((each) => each.metadata.name)
      .sort();

  const failed = (set: SetObject) =>
    set.status?.conditions?.some((each) => each.type === "ErrorOccurred" && each.status === "True");

  const openPage = async () => {
    await clickSidebar(session, frame, PAGE, "argocd");
    await waitFor("the ApplicationSets", async () =>
      (await countOf(session, frame, `${LIST} tbody tr`)) >= sets.length ? true : undefined,
    );
  };

  /** Each body row as its cells' text. */
  const rows = () =>
    session.evaluate<string[][]>(
      `[...document.querySelectorAll("${LIST} tbody tr")].map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim()))`,
      frame,
    );

  const openSet = async (name: string) => {
    const clicked = await session.evaluate<boolean>(
      `(() => {
        const row = [...document.querySelectorAll("${LIST} tbody tr")]
          .find((each) => each.querySelector("td")?.textContent.trim() === ${JSON.stringify(name)});
        row?.querySelector("td")?.click();
        return Boolean(row);
      })()`,
      frame,
    );

    expect(clicked, `no row named ${name}`).toBe(true);
    await waitFor(`${name}'s drawer`, async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="application-set"]`)) > 0
        ? true
        : undefined,
    );
  };

  const closeDrawer = async () => {
    await session.evaluate(
      `[...(${OPEN_DRAWER}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => each.textContent.trim() === "close")?.click()`,
      frame,
    );
    await waitFor("the drawer to close", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="application-set"]`)) === 0
        ? true
        : undefined,
    );
  };

  const textIn = (section: string, selector: string) =>
    session.evaluate<string[]>(
      `[...(${OPEN_DRAWER}?.querySelectorAll('[data-section="${section}"] ${selector}') ?? [])].map((each) => each.textContent.trim())`,
      frame,
    );

  it("needs the seed's sets: one that generates, one that fails", () => {
    expect(sets.some((set) => ownedBy(set).length > 0)).toBe(true);
    expect(sets.some(failed)).toBe(true);
  });

  it("lists every set with its generators, its Applications and its verdict, to the standard", async () => {
    await openPage();

    const listed = await rows();

    expect(listed.map((cells) => cells[0]).sort()).toEqual(
      sets.map((set) => set.metadata.name).sort(),
    );

    for (const set of sets) {
      const cells = listed.find((each) => each[0] === set.metadata.name) ?? [];
      const kinds = (set.spec.generators ?? []).map(
        (generator) => Object.keys(generator).find((key) => key !== "selector") ?? "",
      );

      expect(cells[1]).toBe(set.metadata.namespace);
      for (const kind of kinds) expect(cells[2]).toContain(kind);
      expect(cells[3]).toMatch(new RegExp(`^${ownedBy(set).length} · `));
      expect(cells[4]).toMatch(failed(set) ? /^Error/ : /^Up to date/);
    }

    // A failing set ranks first.
    expect(sets.find((set) => set.metadata.name === listed[0]?.[0] && failed(set))).toBeDefined();
    expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
  }, 90_000);

  it("opens each set's drawer with its generators, template, Applications and conditions", async () => {
    await openPage();

    for (const set of sets) {
      await openSet(set.metadata.name);

      try {
        expect(await drawerTitle(session, frame, DRAWER)).toBe(
          `ApplicationSet: ${set.metadata.name}`,
        );
        expect(await textIn("application-set-generators", ".ArgoCD-box__title b")).toHaveLength(
          (set.spec.generators ?? []).length,
        );
        expect(await textIn("application-set-template", "dt")).toEqual(
          expect.arrayContaining(["Name", "Project", "Destination"]),
        );
        expect((await textIn("application-set-applications", ".ArgoCD-link")).sort()).toEqual(
          ownedBy(set),
        );
        expect(await textIn("application-set-conditions", ".ArgoCD-row__name b")).toEqual(
          (set.status?.conditions ?? []).map((each) => each.type),
        );
        expect(
          await session.evaluate<number>(
            `${OPEN_DRAWER}?.querySelectorAll(".ArgoCD-banner--critical").length ?? 0`,
            frame,
          ),
          "the failure banner",
        ).toBe(failed(set) ? 1 : 0);
        expect(await designViolations(session, frame, "ArgoCD")).toEqual([]);
      } finally {
        await closeDrawer();
      }
    }
  }, 180_000);

  it("opens an owned Application's drawer, whose Managed by link opens the set again", async () => {
    const set = sets.find((each) => ownedBy(each).length > 0);
    const [name] = set ? ownedBy(set) : [];

    expect(name, "no set owns an Application").toBeDefined();
    if (!set || !name) return;

    await openPage();
    await openSet(set.metadata.name);
    await session.evaluate(
      `[...(${OPEN_DRAWER}?.querySelectorAll('[data-section="application-set-applications"] .ArgoCD-link') ?? [])]
        .find((each) => each.textContent.trim() === ${JSON.stringify(name)})?.click()`,
      frame,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await countOf(session, frame, DETAILS)) > 0 ? true : undefined,
    );

    const clicked = await session.evaluate<boolean>(
      `(() => {
        const item = [...document.querySelectorAll("${DETAILS} .DrawerItem")]
          .find((each) => each.querySelector(".name")?.textContent.trim() === "Managed by");
        const link = item?.querySelector(".ArgoCD-link");
        link?.click();
        return link?.textContent.trim() === ${JSON.stringify(set.metadata.name)};
      })()`,
      frame,
    );

    expect(clicked, "Managed by does not name the set").toBe(true);
    await waitFor("the set's drawer", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="application-set"]`)) > 0
        ? true
        : undefined,
    );
    expect(await drawerTitle(session, frame, DRAWER)).toBe(`ApplicationSet: ${set.metadata.name}`);
    await closeDrawer();
  }, 120_000);

  it("draws all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
