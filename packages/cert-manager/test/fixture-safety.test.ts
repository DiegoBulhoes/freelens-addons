import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// This package exports Secrets: fail if a fixture carries what the sanitiser removes.

const FIXTURES = join(__dirname, "fixtures");

const files = readdirSync(FIXTURES).filter((file) => file.endsWith(".json"));

type Item = { kind?: string; metadata?: { annotations?: Record<string, string> } } & Record<
  string,
  unknown
>;

const items = (file: string): Item[] =>
  (JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as { items?: Item[] }).items ?? [];

describe("the fixtures carry no secrets", () => {
  it("has fixtures to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s holds no Secret data", (file) => {
    for (const item of items(file).filter((each) => each.kind === "Secret")) {
      expect(item).not.toHaveProperty("data");
      expect(item).not.toHaveProperty("stringData");
      expect(
        Object.keys(item.metadata?.annotations ?? {}).every((key) =>
          key.startsWith("cert-manager.io/"),
        ),
      ).toBe(true);
    }
  });

  it.each(files)("%s holds no key, no PEM and no base64 blob", (file) => {
    const text = readFileSync(join(FIXTURES, file), "utf8");

    expect(text).not.toContain("tls.key");
    expect(text).not.toContain("-----BEGIN");
    expect(text).not.toMatch(/"[A-Za-z0-9+/=]{200,}"/);
  });

  it.each(files)("%s holds no ACME token, key authorisation or account detail", (file) => {
    const text = readFileSync(join(FIXTURES, file), "utf8");

    for (const field of ["token", "key", "lastPrivateKeyHash", "lastRegisteredEmail", "email"]) {
      expect(text, field).not.toContain(`"${field}":`);
    }
  });

  // The token also sits in the solver path and the self-check message.
  it.each(files)("%s names no ACME challenge path but the redacted one", (file) => {
    const text = readFileSync(join(FIXTURES, file), "utf8");

    for (const path of text.match(/\/\.well-known\/acme-challenge\/[\w-]+/g) ?? []) {
      expect(path).toBe("/.well-known/acme-challenge/redacted-by-fixture-export");
    }
  });

  it.each(files)("%s holds no manifest kubectl apply left behind", (file) => {
    expect(readFileSync(join(FIXTURES, file), "utf8")).not.toContain("last-applied-configuration");
  });
});
