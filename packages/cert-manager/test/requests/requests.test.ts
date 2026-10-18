import { describe, expect, it } from "vitest";

import {
  AWAITING_APPROVAL,
  certificateOfRequest,
  certificateRouteOf,
  isAwaitingApproval,
  requestStateOf,
  revisionOfRequest,
} from "../../src/renderer/api/requests/requests";
import { certificateRequests, certificates, variantOf } from "../support/fixtures";

const requestNamed = (name: string) => {
  const found = certificateRequests().find((each) => each.getName() === name);

  if (!found) throw new Error(`no request named ${name} in the fixtures`);

  return found;
};

describe("which certificate a request is for", () => {
  it("reads the certificate and revision cert-manager wrote on it", () => {
    const request = requestNamed("renewal-stalls-8");

    expect(certificateOfRequest(request)).toBe("renewal-stalls");
    expect(revisionOfRequest(request)).toBe(8);
  });

  it("says nothing, and revision 0, when the annotations are gone", () => {
    const bare = variantOf(requestNamed("web-tls-2"), (raw) => {
      delete raw.metadata.annotations;
    });

    expect(certificateOfRequest(bare)).toBe("");
    expect(revisionOfRequest(bare)).toBe(0);
  });
});

describe("the link from a request to its Certificate", () => {
  it("routes each request to a Certificate that exists, in the request's namespace", () => {
    const known = new Set(certificates().map((each) => `${each.getNs()}/${each.getName()}`));
    const routes = certificateRequests().map(certificateRouteOf);

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route && known.has(`${route.namespace}/${route.name}`), JSON.stringify(route)).toBe(
        true,
      );
    }
    expect(certificateRouteOf(requestNamed("renewal-stalls-8"))).toEqual({
      namespace: "demo",
      name: "renewal-stalls",
    });
  });

  it("offers no link when the request does not say which Certificate it is for", () => {
    const orphan = variantOf(requestNamed("renewal-stalls-8"), (raw) => {
      delete raw.metadata.annotations["cert-manager.io/certificate-name"];
    });

    expect(certificateRouteOf(orphan)).toBeUndefined();
  });
});

describe("a request's state", () => {
  it("calls an issued request Issued, in the fine tone", () => {
    expect(requestStateOf(requestNamed("web-tls-2"))).toMatchObject({
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

  it("says Unknown, with no tone, when it is approved and no issuer has written Ready yet", () => {
    const fresh = variantOf(requestNamed("web-tls-2"), (raw) => {
      raw.status.conditions = raw.status.conditions.filter(
        (each: { type: string }) => each.type !== "Ready",
      );
    });

    expect(requestStateOf(fresh)).toEqual({ label: "Unknown" });
  });

  it("says Awaiting approval, with the cause, while no approver has approved it", () => {
    const unapproved = variantOf(requestNamed("acme-web-1"), (raw) => {
      raw.status.conditions = raw.status.conditions.filter(
        (each: { type: string }) => each.type !== "Approved",
      );
    });
    const untouched = variantOf(requestNamed("web-tls-2"), (raw) => {
      delete raw.status;
    });

    expect(requestStateOf(unapproved)).toEqual({
      label: "Awaiting approval",
      tone: "warning",
      message: AWAITING_APPROVAL,
    });
    expect(requestStateOf(untouched).label).toBe("Awaiting approval");
  });

  it("does not wait on approval once it is issued or has failed", () => {
    const strip = (name: string, failed = false) =>
      variantOf(requestNamed(name), (raw) => {
        raw.status.conditions = raw.status.conditions.filter(
          (each: { type: string }) => each.type !== "Approved",
        );
        if (failed) {
          raw.status.conditions.find((each: { type: string }) => each.type === "Ready").reason =
            "Failed";
        }
      });

    expect(isAwaitingApproval(strip("web-tls-2"))).toBe(false);
    expect(requestStateOf(strip("acme-web-1", true)).label).toBe("Failed");
    expect(isAwaitingApproval(requestNamed("acme-web-1"))).toBe(false);
  });

  it("falls back to the condition's status when it carries no reason", () => {
    const reasonless = (status: string) =>
      variantOf(requestNamed("web-tls-2"), (raw) => {
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
