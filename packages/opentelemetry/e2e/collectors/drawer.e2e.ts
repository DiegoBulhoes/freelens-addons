import { describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import { clusterItems, countOf, type ErrorLog, waitFor } from "../../../../build/e2e/freelens";
import { COLLECTOR_BODY, DRAWER, openCollector } from "../support/lists";
import { factOf, follow, terms, useWorkbench } from "../support/opentelemetry";

describe("an OpenTelemetry drawer", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  useWorkbench((opened) => ({ session, frame, errors } = opened), true);

  it.each([
    [
      "gateway in the OpenTelemetry collectors list",
      "/crd/opentelemetry.io/opentelemetrycollectors",
      "gateway",
    ],
    ["gateway-collector in the Deployments list", "/deployments", "gateway-collector"],
  ])(
    "leaves the gateway's drawer by %s",
    async (ending, path, name) => {
      await openCollector(session, frame, "otel-collectors/gateway");
      await follow(session, frame, ending, path, name);
    },
    90_000,
  );

  it("lists a crash-looping target allocator's pods, their log and why they exit", async () => {
    await openCollector(session, frame, "otel-allocator/allocator");

    expect(await factOf(session, frame, "State")).toMatch(
      /^Target allocator (crash looping|not ready)$/,
    );

    const allocator = `${DRAWER} [data-section="opentelemetry-collector-allocator"]`;

    expect(await countOf(session, frame, `${allocator} .OpenTelemetry-row`)).toBeGreaterThan(0);
    expect(
      await session.evaluate<string[]>(
        `[...document.querySelectorAll('${allocator} button')].map((each) => each.textContent.trim())`,
        frame,
      ),
    ).toContain("Log");

    const commands = await waitFor("the target allocator's previous log", async () => {
      const found = await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} [data-section="opentelemetry-collector-commands"] code')].map((each) => each.textContent)`,
        frame,
      );

      return found.some((each) => each.includes("-c ta-container --previous")) ? found : undefined;
    });

    expect(commands.length).toBeGreaterThan(0);
    expect(await designViolations(session, frame, "OpenTelemetry")).toEqual([]);
  }, 90_000);

  it("finds the sidecar collector in its carrier, in another namespace", async () => {
    await openCollector(session, frame, "otel-collectors/sidecar");

    const pods = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="opentelemetry-collector-pods"] .OpenTelemetry-row__name')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(pods.length).toBeGreaterThan(0);
    expect(pods.every((each) => each.startsWith("carrier-"))).toBe(true);
  }, 60_000);

  // scraper is seeded by the Prometheus component, which this extension's CI leg does not install.
  it("opens the Prometheus Monitors from a collector that reads monitors", async (context) => {
    const collectors = await clusterItems<{ metadata: { name: string } }>(
      session,
      frame,
      "/apis/opentelemetry.io/v1beta1/namespaces/otel-collectors/opentelemetrycollectors",
    );

    if (!collectors.some((each) => each.metadata.name === "scraper")) context.skip();

    await openCollector(session, frame, "otel-collectors/scraper");
    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} .OpenTelemetry-link')].find((each) => each.textContent === "scraper in the Prometheus Monitors list").click()`,
      frame,
    );

    const landed = await waitFor("the Prometheus extension's Monitors", async () => {
      const where = await session.evaluate<string>("location.pathname + location.search", frame);

      return where.includes("prometheus/monitors") ? where : undefined;
    });

    expect(new URLSearchParams(landed.slice(landed.indexOf("?"))).get("name")).toBe("scraper");
  }, 90_000);

  it("explains a crash-looping collector from its previous log, with its pods and commands", async () => {
    await openCollector(session, frame, "otel-collectors/broken");

    const banner = await waitFor(
      "the cause in the banner",
      async () => {
        const text = await session.evaluate<string>(
          `document.querySelector('${DRAWER} .OpenTelemetry-banner__body')?.textContent ?? ""`,
          frame,
        );

        return /which is not configured/.test(text) ? text : undefined;
      },
      90_000,
    );

    expect(banner).toMatch(/exit code \d+/);
    expect(await terms(session, frame)).toEqual(
      expect.arrayContaining(["Mode", "Pods", "Version", "Image", "Target allocator"]),
    );

    const buttons = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="opentelemetry-collector-pods"] button')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(buttons).toContain("Log");

    const commands = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="opentelemetry-collector-commands"] code')].map((each) => each.textContent)`,
      frame,
    );

    expect(commands.some((each) => each.includes("--previous"))).toBe(true);
    expect(await countOf(session, frame, COLLECTOR_BODY)).toBeGreaterThan(0);
    expect(await designViolations(session, frame, "OpenTelemetry")).toEqual([]);
  }, 120_000);

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
