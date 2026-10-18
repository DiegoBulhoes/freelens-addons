import { describe, expect, it } from "vitest";

import { ago, formatAge, worstFirst } from "../../src/renderer/api/shared/verdict";

describe("verdicts and times", () => {
  it("says how long ago", () => {
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(72 * 3_600_000)).toBe("3d");
    expect(ago(undefined, 0)).toBe("—");
    expect(ago("nonsense", 0)).toBe("—");
    expect(ago("1970-01-01T00:00:00Z", 600_000)).toBe("10m ago");
    expect(ago("1970-01-01T00:00:00Z", 10_000)).toBe("just now");
  });
});

describe("worst first", () => {
  it("orders by tone, then namespace and name", () => {
    const row = (tone: "critical" | "warning" | "ok", namespace: string, name: string) => ({
      verdict: { tone, label: "", reason: "" },
      namespace,
      name,
    });
    const rows = [
      row("ok", "a", "x"),
      row("warning", "b", "y"),
      row("critical", "b", "b"),
      row("critical", "b", "a"),
      row("critical", "a", "z"),
    ];

    expect(
      worstFirst(rows).map((each) => `${each.verdict.tone} ${each.namespace}/${each.name}`),
    ).toEqual(["critical a/z", "critical b/a", "critical b/b", "warning b/y", "ok a/x"]);
    expect(rows[0]?.name).toBe("x");
  });
});
