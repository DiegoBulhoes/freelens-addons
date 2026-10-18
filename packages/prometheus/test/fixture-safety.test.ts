import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { agents, named, prometheuses, scrapeConfigs, serviceMonitors } from "./support/fixtures";

// The seed carries fake credentials: fail if a fixture keeps what the sanitiser removes.

const FIXTURES = join(__dirname, "fixtures");

const files = readdirSync(FIXTURES).filter((file) => file.endsWith(".json"));

const text = (file: string) => readFileSync(join(FIXTURES, file), "utf8");

const REDACTED = "https://redacted-by-fixture-export.example.test/api/v1";

describe("the fixtures carry no credentials", () => {
  it("has fixtures to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no-image's remote write and read keep only a redacted URL", () => {
    const { spec } = named(prometheuses(), "prom-broken/no-image") as unknown as {
      spec: Record<string, Record<string, unknown>[] & Record<string, unknown>>;
    };

    expect(spec.remoteWrite).toEqual([{ url: `${REDACTED}/write` }]);
    expect(spec.remoteRead).toEqual([{ url: `${REDACTED}/read` }]);
    expect(spec.apiserverConfig).toEqual({ host: "https://kubernetes.default.svc" });
  });

  it("the paused agent's remote write keeps only a redacted URL", () => {
    const { spec } = named(agents(), "monitoring/agent") as unknown as {
      spec: { remoteWrite?: unknown[] };
    };

    expect(spec.remoteWrite).toEqual([{ url: `${REDACTED}/write` }]);
  });

  it("scrape params are redacted and proxies dropped", () => {
    const orphan = named(serviceMonitors(), "prom-apps/orphan").spec.endpoints?.[0] as Record<
      string,
      unknown
    >;
    const staticSelf = named(scrapeConfigs(), "prom-apps/static-self").spec as Record<
      string,
      unknown
    >;

    expect(orphan.params).toEqual({ token: ["redacted-by-fixture-export"] });
    expect(orphan).not.toHaveProperty("proxyUrl");
    expect(staticSelf.params).toEqual({ token: ["redacted-by-fixture-export"] });
  });

  it.each(files)("%s holds no credential field and no fake value", (file) => {
    for (const field of ["bearerToken", "headers", "proxyUrl", "endpointParams"]) {
      expect(text(file), field).not.toContain(`"${field}":`);
    }
    expect(text(file)).not.toContain("seed-fake-token");
  });

  it.each(files)("%s holds no URL query", (file) => {
    expect(text(file)).not.toMatch(/https?:\/\/[^\s"?]+\?/);
  });

  // k3s's applied annotation is gzip and base64, which hides addresses from the rewriter.
  it.each(files)("%s holds no applied manifest", (file) => {
    expect(text(file)).not.toContain("last-applied-configuration");
    expect(text(file)).not.toContain("objectset.rio.cattle.io/applied");
  });

  it.each(files)("%s holds no IPv4 address but documentation and loopback ones", (file) => {
    const addresses = text(file).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];

    expect(
      addresses.filter((address) => !address.startsWith("198.51.100.") && address !== "127.0.0.1"),
    ).toEqual([]);
  });
});
