import { describe, expect, it } from "vitest";

import {
  keyOf,
  type Resolution,
  resolveInstrumentation,
} from "../../src/renderer/api/coverage/resolve";
import { instrumentations } from "../support/fixtures";

const resolve = (value: string, namespace: string) =>
  resolveInstrumentation(value, namespace, instrumentations());

const resolvedTo = (resolution: Resolution) =>
  resolution.kind === "resolved"
    ? `${keyOf(resolution.instrumentation)} by ${resolution.by}`
    : resolution.kind;

describe("resolving an annotation value", () => {
  it('resolves "true" to the only Instrumentation in the pod\'s namespace, ignoring case', () => {
    expect(resolvedTo(resolve("true", "otel-apps"))).toBe(
      "otel-apps/python by only one in the namespace",
    );
    expect(resolvedTo(resolve("TRUE", "otel-late"))).toBe(
      "otel-late/python by only one in the namespace",
    );
  });

  it('finds nothing for "true" where there is none, and refuses to choose between two', () => {
    expect(resolve("true", "otel-orphan")).toEqual({ kind: "missing", namespace: "otel-orphan" });
    expect(resolve("true", "otel-ambiguous")).toEqual({
      kind: "ambiguous",
      namespace: "otel-ambiguous",
      candidates: ["python-a", "python-b"],
    });
  });

  it("resolves a name in the pod's namespace, and namespace/name in any namespace", () => {
    expect(resolvedTo(resolve("python", "otel-apps"))).toBe("otel-apps/python by name");
    expect(resolvedTo(resolve("otel-apps/python", "otel-orphan"))).toBe("otel-apps/python by name");
    expect(resolvedTo(resolve("python-a", "otel-ambiguous"))).toBe(
      "otel-ambiguous/python-a by name",
    );
  });

  it("reports a name that does not exist, where it looked", () => {
    expect(resolve("absent", "otel-apps")).toEqual({
      kind: "missing",
      namespace: "otel-apps",
      name: "absent",
    });
    expect(resolve("otel-late/absent", "otel-apps")).toEqual({
      kind: "missing",
      namespace: "otel-late",
      name: "absent",
    });
    expect(resolve("python", "otel-orphan")).toMatchObject({ kind: "missing" });
  });

  it("waits, rather than calls anything missing, until the Instrumentations are read", () => {
    expect(resolveInstrumentation("true", "otel-orphan", undefined)).toEqual({
      kind: "unread",
      namespace: "otel-orphan",
    });
    expect(resolveInstrumentation("otel-apps/python", "otel-orphan", undefined)).toEqual({
      kind: "unread",
      namespace: "otel-apps",
    });
    expect(resolveInstrumentation("false", "otel-orphan", undefined)).toEqual({ kind: "off" });
  });

  it('is off for "false", in any case, and for no value', () => {
    expect(resolve("false", "otel-apps")).toEqual({ kind: "off" });
    expect(resolve("False", "otel-apps")).toEqual({ kind: "off" });
    expect(resolve("", "otel-apps")).toEqual({ kind: "off" });
  });
});
