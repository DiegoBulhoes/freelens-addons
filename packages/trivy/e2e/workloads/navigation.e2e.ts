import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  countOf,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { clickFirst, location } from "../support/trivy";
import { BODY, column, openRow, openWorkloads, waitForPods } from "../support/workloads";

describe("a row click goes somewhere", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  it("takes a pod row in a workload's drawer to the host's Pods list, narrowed to that pod", async () => {
    const rows = await openWorkloads(session, frame);
    const coverage = await column(session, frame, "Coverage");
    const pods = `${BODY} [data-section="trivy-workload-pods"] button.Trivy-row`;

    // Pods of a workload can be gone, so walk until one has any.
    let podName = "";

    for (let index = 0; index < rows && podName === ""; index++) {
      if (coverage[index] !== "Scanned") continue;

      await openRow(session, frame, index);
      await waitForPods(session, frame);
      podName = await textOf(session, frame, `${pods} .Trivy-truncate`);
    }

    expect(podName, "no workload has a running pod").not.toBe("");
    expect(await clickFirst(session, frame, pods)).toBe(true);

    const landed = await waitFor("the Pods list", async () => {
      const where = await location(session, frame);

      return where.startsWith("/pods") ? where : undefined;
    });

    // The host reads ?search= on every list.
    expect(landed).toContain("search=");
    expect(decodeURIComponent(landed)).toContain(podName);
    expect(await countOf(session, frame, BODY), "the drawer stayed open over the Pods list").toBe(
      0,
    );
  }, 150_000);

  it("takes a ReplicaSet's owner in its drawer to the host's Deployments list, narrowed to it", async () => {
    await openWorkloads(session, frame);

    const names = await column(session, frame, "Workload");
    const namespaces = await column(session, frame, "Namespace");
    const coverage = await column(session, frame, "Coverage");
    const index = names.findIndex(
      (name, at) =>
        name.startsWith("web-") && namespaces[at] === "demo" && coverage[at] === "Scanned",
    );

    expect(index, "the seed's web is not scanned").toBeGreaterThanOrEqual(0);
    await openRow(session, frame, index);

    const clicked = await session.evaluate<boolean>(
      `(() => {
        const facts = [...document.querySelectorAll(${JSON.stringify(`${BODY} > .Trivy-facts > dt`)})];
        const owner = facts.find((each) => each.textContent.trim() === "Deployment");
        const link = owner?.nextElementSibling?.querySelector("button.Trivy-link");
        if (!link || link.textContent.trim() !== "web") return false;
        link.click();
        return true;
      })()`,
      frame,
    );

    expect(clicked, "web's drawer names no Deployment web").toBe(true);

    const landed = await waitFor("the Deployments list", async () => {
      const where = await location(session, frame);

      return where.startsWith("/deployments") ? where : undefined;
    });

    expect(decodeURIComponent(landed)).toContain("search=web");
    expect(
      await countOf(session, frame, BODY),
      "the drawer stayed open over the Deployments list",
    ).toBe(0);
  }, 150_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
