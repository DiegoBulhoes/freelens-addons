import { describe, expect, it } from "vitest";

import { describeOutcome, planFor, renewalRefusal } from "../src/renderer/api/bulk";
import type { ChainInputs } from "../src/renderer/api/chain";
import {
  certificateNamed,
  certificateRequests,
  certificates,
  challenges,
  issuerIndex,
  orders,
} from "./fixtures";

const inputs: ChainInputs = {
  index: issuerIndex(),
  requests: certificateRequests(),
  orders: orders(),
  challenges: challenges(),
};

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
    expect(renewalRefusal(inputs)(certificateNamed("web-tls"))).toBeUndefined();
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
