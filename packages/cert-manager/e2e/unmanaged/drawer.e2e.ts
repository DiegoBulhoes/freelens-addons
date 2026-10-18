import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import {
  countOf,
  drawerTitle,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { openRow as openRowOf } from "../support/cert-manager";
import { DRAWER } from "../support/lists";

describe("opening a row of each cert-manager list", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const title = () => drawerTitle(session, frame, DRAWER);

  const openRow = (page: string, list: string, section: string, predicate?: string) =>
    openRowOf(session, frame, page, list, section, predicate);

  it("leaves an unmanaged Ingress's drawer for the host's list, narrowed to it", async () => {
    await openRow("cert-manager-unmanaged", "served", "cert-manager-served");

    const ingress = (await title()).replace(/^Ingress: /, "");

    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} .CertManager-link')].find((each) => each.textContent.endsWith("in the Ingresses list")).click()`,
      frame,
    );

    const landed = await waitFor("the host's Ingresses list", async () => {
      const path = await session.evaluate<string>("location.pathname + location.search", frame);

      return path.startsWith("/ingresses") ? path : undefined;
    });

    expect(decodeURIComponent(landed)).toContain(`search=${ingress}`);
    expect(await countOf(session, frame, `${DRAWER} [data-section="cert-manager-served"]`)).toBe(0);
  }, 90_000);

  it("says why a TLS Secret is unmanaged, and leaves for the host's Secrets list", async () => {
    await openRow("cert-manager-unmanaged", "secrets", "cert-manager-secret");

    const secret = (await title()).replace(/^Secret: /, "");
    const why = await textOf(
      session,
      frame,
      `${DRAWER} [data-section="cert-manager-secret"] > :is(.CertManager-muted, .CertManager-banner)`,
    );

    expect(why).toMatch(/No Certificate writes it|no longer exists/);

    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} .CertManager-link')].find((each) => each.textContent.endsWith("in the Secrets list")).click()`,
      frame,
    );

    const landed = await waitFor("the host's Secrets list", async () => {
      const path = await session.evaluate<string>("location.pathname + location.search", frame);

      return path.startsWith("/secrets") ? path : undefined;
    });

    expect(decodeURIComponent(landed)).toContain(`search=${secret}`);
  }, 90_000);

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
