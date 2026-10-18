import { describe, expect, it } from "vitest";

import {
  describeOutcome,
  listNames,
  planFor,
  planWarning,
  renewalRefusal,
  renewalWarning,
} from "../../src/renderer/api/writes/bulk";
import { certificateNamed, certificates, chainInputs, variantOf } from "../support/fixtures";

const inputs = chainInputs();

describe("planning a bulk renewal", () => {
  const plan = planFor(certificates(), renewalRefusal(inputs));
  const ready = plan.ready.map((each) => each.getName());
  const skipped = Object.fromEntries(
    plan.skipped.map(({ item, reason }) => [item.getName(), reason]),
  );

  it("renews what nothing is issuing yet", () => {
    expect(ready).toContain("web-tls");
    expect(ready).toContain("ends-this-week");
  });

  it("skips what cert-manager is already issuing, saying so and what holds it up", () => {
    expect(skipped["acme-web"]).toMatch(/already issuing.*Challenge acme-web-1-/);
    expect(skipped["renewal-stalls"]).toMatch(/already issuing.*Issuer flaky-ca/);
    expect(Object.keys(skipped)).not.toContain("web-tls");
  });

  it("keeps every certificate in one list or the other", () => {
    expect(plan.ready.length + plan.skipped.length).toBe(certificates().length);
  });

  it("does not skip a certificate whose issuer is broken but which is not issuing", () => {
    // web-tls on flaky-ca, as if issued before flaky-ca lost its key: Ready, nothing issuing.
    const onFlaky = variantOf(certificateNamed("web-tls"), (raw) => {
      raw.spec.issuerRef = { name: "flaky-ca", kind: "Issuer", group: "cert-manager.io" };
    });

    expect(renewalRefusal(inputs)(onFlaky)).toBeUndefined();
    expect(planFor([onFlaky], renewalRefusal(inputs)).ready).toEqual([onFlaky]);
    expect(renewalWarning(inputs)(onFlaky)).toMatch(/Issuer flaky-ca.*will fail/);
  });

  it("keeps the order it was given", () => {
    const picked = [certificateNamed("web-tls"), certificateNamed("ends-this-month")];

    expect(planFor(picked, () => undefined).ready).toEqual(picked);
    expect(planFor(picked, () => "no").skipped.map(({ item }) => item)).toEqual(picked);
  });
});

describe("reporting a bulk outcome", () => {
  it("counts what was done out of what was tried", () => {
    expect(describeOutcome("Requested renewal for", 3, [])).toBe("Requested renewal for 3 of 3.");
  });

  it("names each failure with its cause", () => {
    expect(
      describeOutcome("Requested renewal for", 1, ["demo/a (Not allowed)", "demo/b (409)"]),
    ).toBe("Requested renewal for 1 of 3. Failed: demo/a (Not allowed); demo/b (409).");
  });
});

describe("warning before a bulk renewal", () => {
  // web-tls moved onto the broken Issuer: Ready, nothing issuing, so renewing is offered.
  const onBroken = variantOf(certificateNamed("web-tls"), (raw) => {
    raw.spec.issuerRef = { name: "broken-ca", kind: "Issuer", group: "cert-manager.io" };
  });
  const keyOf = (each: { getNs(): string | undefined; getName(): string }) =>
    `${each.getNs()}/${each.getName()}`;

  it("warns, as single Renew does, of a renewal its broken issuer will fail", () => {
    const picked = [certificateNamed("ends-this-week"), onBroken];
    const plan = planFor(picked, renewalRefusal(inputs));

    expect(plan.ready).toEqual(picked);
    expect(planWarning(plan.ready, renewalWarning(inputs), keyOf)).toBe(
      "demo/web-tls: Its issuer is not usable (Issuer broken-ca), so the renewal will fail until that is fixed.",
    );
  });

  it("warns of nothing when every issuer is usable, or when no warning is asked for", () => {
    const healthy = [certificateNamed("web-tls"), certificateNamed("ends-this-week")];

    expect(planWarning(healthy, renewalWarning(inputs), keyOf)).toBeUndefined();
    expect(planWarning([onBroken], undefined, keyOf)).toBeUndefined();
  });

  it("does not warn about what it skips, which is listed with its reason instead", () => {
    expect(renewalWarning(inputs)(certificateNamed("renewal-stalls"))).toBeUndefined();
  });

  it("caps a long warning as it caps the names", () => {
    const many = Array.from({ length: 10 }, (_, at) => `demo/c${at}`);

    expect(
      planWarning(
        many,
        () => "broken.",
        (name) => name,
      ),
    ).toMatch(/demo\/c7: broken\. And 2 more like these\.$/);
    expect(listNames(many)).toMatch(/demo\/c7 and 2 more$/);
    expect(listNames(many.slice(0, 2))).toBe("demo/c0, demo/c1");
  });
});
