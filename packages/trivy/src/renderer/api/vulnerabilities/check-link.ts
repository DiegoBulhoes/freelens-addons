// Only AVD-style ids get a link: anything else lands on a 404.

const AVD_ID = /^AVD-[A-Z]+-\d+$/;

export const AVD_MISCONFIG = "https://avd.aquasec.com/misconfig/";

export function checkLink(checkID: string | undefined): string | undefined {
  if (!checkID || !AVD_ID.test(checkID)) return undefined;

  return `${AVD_MISCONFIG}${checkID.toLowerCase()}`;
}

// The link comes from the scanner's database: React 17 would still render a `javascript:` href.
export function findingLink(link: string | undefined): string | undefined {
  if (!link) return undefined;

  try {
    const url = new URL(link);

    return url.protocol === "https:" && url.username === "" && url.password === ""
      ? link
      : undefined;
  } catch {
    return undefined;
  }
}
