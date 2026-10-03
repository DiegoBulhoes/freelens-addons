import { describe, expect, it } from "vitest";

import { AVD_MISCONFIG, checkLink } from "../src/renderer/api/check-link";
import { allRbacReports, configAuditReports } from "./fixtures";

const idsOf = (reports: { report?: { checks?: { checkID?: string }[] } }[]) =>
  reports.flatMap((each) => (each.report?.checks ?? []).map((check) => check.checkID));

describe("linking a check to where it is explained", () => {
  it("links every config audit and RBAC check the cluster reported", () => {
    const ids = [...idsOf(configAuditReports()), ...idsOf(allRbacReports())];

    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      expect(checkLink(id), id).toBe(`${AVD_MISCONFIG}${id?.toLowerCase()}`);
    }
  });

  it("builds the address the database redirects from", () => {
    expect(checkLink("AVD-KSV-0021")).toBe("https://avd.aquasec.com/misconfig/avd-ksv-0021");
  });

  it.each([undefined, "", "KSV021", "avd-ksv-0021", "AVD-KSV-0021/../admin", "AVD-KSV-"])(
    "gives %j no link rather than a wrong one",
    (id) => {
      expect(checkLink(id)).toBeUndefined();
    },
  );
});
