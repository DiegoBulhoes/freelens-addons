/**
 * Where a check is explained: Aqua's vulnerability database, the site a CVE's
 * `primaryLink` already points into. A config audit or RBAC report names the
 * check by id and carries no URL, so the address is built from the id, in the
 * form that redirects to the check's own page (`AVD-KSV-0021` →
 * `…/misconfig/avd-ksv-0021`).
 *
 * An id not in that form gets no link at all: a link that lands on the
 * database's 404 page is worse than none.
 */

const AVD_ID = /^AVD-[A-Z]+-\d+$/;

export const AVD_MISCONFIG = "https://avd.aquasec.com/misconfig/";

export function checkLink(checkID: string | undefined): string | undefined {
  if (!checkID || !AVD_ID.test(checkID)) return undefined;

  return `${AVD_MISCONFIG}${checkID.toLowerCase()}`;
}
