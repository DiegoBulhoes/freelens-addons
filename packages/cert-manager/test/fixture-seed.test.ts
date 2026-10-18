import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { certificates } from "./support/fixtures";

// A fixture exported before a seed change tests a state the dev k3s no longer produces.

const SAMPLES = join(
  __dirname,
  "../../../dev/cluster/components/cert-manager-samples/samples.yaml",
);

const seeded = readFileSync(SAMPLES, "utf8")
  .split(/^---$/m)
  .filter((document) => /^kind: Certificate$/m.test(document))
  .map((document) => ({
    name: document.match(/^ {2}name: (\S+)$/m)?.[1] ?? "",
    duration: document.match(/^ {2}duration: (\S+)$/m)?.[1],
    renewBefore: document.match(/^ {2}renewBefore: (\S+)$/m)?.[1],
  }))
  .filter((certificate) => certificate.duration);

describe("the fixtures match the seed", () => {
  it("has seeded durations to compare", () => {
    expect(seeded.map((certificate) => certificate.name)).toContain("renewal-stalls");
  });

  it.each(seeded)("$name has the seed's duration and renewBefore", (seed) => {
    const exported = certificates().find(
      (each) => each.getNs() === "demo" && each.getName() === seed.name,
    );

    if (seed.name === "retired-tls") {
      expect(exported).toBeUndefined();

      return;
    }

    expect(exported, seed.name).toBeDefined();
    expect(exported?.spec.duration).toBe(seed.duration);
    expect(exported?.spec.renewBefore).toBe(seed.renewBefore);
  });
});
