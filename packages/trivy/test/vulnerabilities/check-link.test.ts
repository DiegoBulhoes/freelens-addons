import { describe, expect, it } from "vitest";

import {
  AVD_MISCONFIG,
  checkLink,
  findingLink,
} from "../../src/renderer/api/vulnerabilities/check-link";
import { allRbacReports, allVulnerabilities, configAuditReports } from "../support/fixtures";

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

describe("linking a finding to its advisory", () => {
  it("keeps every advisory link the cluster's reports carry", () => {
    const links = allVulnerabilities()
      .map((finding) => finding.primaryLink)
      .filter((link): link is string => Boolean(link));

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) expect(findingLink(link), link).toBe(link);
  });

  it.each([
    undefined,
    "",
    "javascript:alert(document.domain)",
    " javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://avd.aquasec.com/nvd/cve-2026-25681",
    "//avd.aquasec.com/nvd/cve-2026-25681",
    "avd.aquasec.com/nvd/cve-2026-25681",
    "https://user:secret@avd.aquasec.com/nvd/cve-2026-25681",
    "not a link",
  ])("gives %j no link", (link) => {
    expect(findingLink(link)).toBeUndefined();
  });
});
