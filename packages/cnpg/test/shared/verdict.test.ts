import { describe, expect, it } from "vitest";

import { type Verdict, withCause } from "../../src/renderer/api/shared/verdict";

const verdict: Verdict = { tone: "warning", label: "Backup failed", reason: "It did not finish." };

describe("withCause", () => {
  it("leaves the verdict alone without a cause", () => {
    expect(withCause(verdict)).toBe(verdict);
  });

  it("appends the cause to the reason", () => {
    expect(withCause(verdict, "x")).toEqual({ ...verdict, reason: "It did not finish. Cause: x" });
  });
});
