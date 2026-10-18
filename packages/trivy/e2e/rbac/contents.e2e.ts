import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  countOf,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { clickFirst, location } from "../support/trivy";

const ROLES = "/apis/rbac.authorization.k8s.io/v1/roles";
const CLUSTER_ROLES = "/apis/rbac.authorization.k8s.io/v1/clusterroles";

describe("what the Trivy pages say", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  it("lists the RBAC findings once per check rather than once per role", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");
    await waitFor(
      "the checks",
      async () => (await countOf(session, frame, ".Trivy-table tbody tr")) > 0 || undefined,
    );

    const rows = await session.evaluate<{ id: string; roles: number }[]>(
      `(() => {
        const headers = [...document.querySelectorAll('.Trivy-table thead th')]
          .map((each) => each.textContent.trim());
        const at = (title) => headers.indexOf(title);
        return [...document.querySelectorAll('.Trivy-table tbody tr')].map((row) => ({
          id: row.children[at("ID")].textContent.trim(),
          roles: Number(row.children[at("Roles")].textContent) +
            Number(row.children[at("ClusterRoles")].textContent),
        }));
      })()`,
      frame,
    );

    expect(new Set(rows.map((row) => row.id)).size, "a check is listed more than once").toBe(
      rows.length,
    );
    expect(
      rows.filter((row) => row.roles > 1).length,
      "no check gathers more than one role, so nothing is grouped",
    ).toBeGreaterThan(0);
  }, 150_000);

  it("counts no more roles under its title than the cluster has", async () => {
    const roles = await clusterItems(session, frame, ROLES);
    const clusterRoles = await clusterItems(session, frame, CLUSTER_ROLES);

    await clickSidebar(session, frame, "trivy-rbac", "trivy");

    const subline = await waitFor("the RBAC subline", async () => {
      const text = await textOf(session, frame, ".Trivy-page__subline");

      return text.length > 0 ? text : undefined;
    });

    const match = /(\d+) critical grants? across (\d+) roles?/.exec(subline);

    expect(match, `the subline does not count: ${subline}`).not.toBeNull();
    expect(Number(match?.[2]), "more roles than the cluster has").toBeLessThanOrEqual(
      roles.length + clusterRoles.length,
    );
    expect(Number(match?.[2])).toBeGreaterThan(0);
  }, 150_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});

describe("a row click goes somewhere", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  it("takes a role in a check's drawer to the host's list of its kind, narrowed to it", async () => {
    await clickSidebar(session, frame, "trivy-rbac", "trivy");
    await waitFor(
      "a check to open",
      async () => (await countOf(session, frame, ".Trivy-table tbody tr")) > 0 || undefined,
    );

    expect(await clickFirst(session, frame, ".Trivy-table tbody tr")).toBe(true);

    const role = await waitFor("a role in the drawer", async () => {
      const found = await session.evaluate<{ name: string; kind: string } | null>(
        `(() => {
          const row = document.querySelector('.TrivyObjectDrawer .Trivy-table tbody tr');
          if (!row) return null;
          return {
            name: row.querySelector('.Trivy-link').textContent.trim(),
            kind: row.children[1].textContent.trim(),
          };
        })()`,
        frame,
      );

      return found ?? undefined;
    });

    expect(
      await clickFirst(session, frame, ".TrivyObjectDrawer .Trivy-table tbody tr .Trivy-link"),
    ).toBe(true);

    const list = role.kind === "ClusterRole" ? "/cluster-roles" : "/roles";
    const landed = await waitFor(`the ${list} list`, async () => {
      const where = await location(session, frame);

      return where.startsWith(list) ? where : undefined;
    });

    expect(decodeURIComponent(landed)).toContain(`search=${role.name}`);
  }, 150_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
