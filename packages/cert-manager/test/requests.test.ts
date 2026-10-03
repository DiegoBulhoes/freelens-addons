import { describe, expect, it } from "vitest";

import {
  certificateOfRequest,
  requestStateOf,
  revisionOfRequest,
} from "../src/renderer/api/requests";
import { certificateRequests, variantOf } from "./fixtures";

const requestNamed = (name: string) => {
  const found = certificateRequests().find((each) => each.getName() === name);

  if (!found) throw new Error(`no request named ${name} in the fixtures`);

  return found;
};

describe("which certificate a request is for", () => {
  it("reads the certificate and revision cert-manager wrote on it", () => {
    const request = requestNamed("renewal-stalls-2");

    expect(certificateOfRequest(request)).toBe("renewal-stalls");
    expect(revisionOfRequest(request)).toBe(2);
  });

  it("says nothing, and revision 0, when the annotations are gone", () => {
    const bare = variantOf(requestNamed("web-tls-1"), (raw) => {
      delete raw.metadata.annotations;
    });

    expect(certificateOfRequest(bare)).toBe("");
    expect(revisionOfRequest(bare)).toBe(0);
  });
});

describe("a request's state", () => {
  it("calls an issued request Issued, in the fine tone", () => {
    expect(requestStateOf(requestNamed("web-tls-1"))).toMatchObject({
      label: "Issued",
      tone: "ok",
    });
  });

  it("calls a waiting request Pending, on its way, with cert-manager's sentence", () => {
    const state = requestStateOf(requestNamed("acme-web-1"));

    expect(state).toMatchObject({ label: "Pending", tone: "warning" });
    expect(state.message).toBeTruthy();
  });

  it("calls a failed request Failed, broken now", () => {
    const failed = variantOf(requestNamed("acme-web-1"), (raw) => {
      const ready = raw.status.conditions.find((each: { type: string }) => each.type === "Ready");
      ready.reason = "Failed";
    });

    expect(requestStateOf(failed)).toMatchObject({ label: "Failed", tone: "critical" });
  });

  it("says Denied first, whatever its Ready condition still says", () => {
    const denied = variantOf(requestNamed("acme-web-1"), (raw) => {
      raw.status.conditions.push({
        type: "Denied",
        status: "True",
        reason: "Denied",
        message: "denied by policy",
      });
    });

    expect(requestStateOf(denied)).toEqual({
      label: "Denied",
      tone: "critical",
      message: "denied by policy",
    });
  });

  it("says Unknown, with no tone, before cert-manager has written a condition", () => {
    const fresh = variantOf(requestNamed("web-tls-1"), (raw) => {
      delete raw.status;
    });

    expect(requestStateOf(fresh)).toEqual({ label: "Unknown" });
  });

  it("falls back to the condition's status when it carries no reason", () => {
    const reasonless = (status: string) =>
      variantOf(requestNamed("web-tls-1"), (raw) => {
        const ready = raw.status.conditions.find((each: { type: string }) => each.type === "Ready");
        delete ready.reason;
        ready.status = status;
      });

    expect(requestStateOf(reasonless("True")).label).toBe("Issued");
    expect(requestStateOf(reasonless("False"))).toMatchObject({
      label: "Unknown",
      tone: "warning",
    });
  });
});
