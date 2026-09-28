import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A guard on the fixtures themselves, because this is the one package that
 * exports Secrets. `scripts/sanitise-fixture.py` removes their data; this fails
 * the build if a fixture ever carries it anyway — a refresh with an old
 * sanitiser, a hand edit, a kind that grew a field.
 *
 * It checks the shape and the text both. The shape is what the sanitiser
 * promises; the text is what would actually leak.
 */

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

  // ACME's side of the conversation with the CA. Gitleaks fails the build on
  // the tokens; this fails it first, and names the file.
  it.each(files)("%s holds no ACME token, key authorisation or account detail", (file) => {
    const text = readFileSync(join(FIXTURES, file), "utf8");

    for (const field of ["token", "key", "lastPrivateKeyHash", "lastRegisteredEmail", "email"]) {
      expect(text, field).not.toContain(`"${field}":`);
    }
  });

  // The token again, inside the URL the CA fetches: the solver Ingress's path
  // and the Challenge's self-check message both carry it.
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
