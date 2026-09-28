import { checkLink } from "../api/check-link";

/**
 * A check's id, as a link to where Trivy's database explains it and how to fix
 * it. Nothing when the id cannot be turned into an address that exists.
 */
export function CheckLink({ checkID }: { checkID: string | undefined }) {
  const href = checkLink(checkID);

  if (!href) return null;

  return (
    <a
      className="Trivy-row__aside"
      href={href}
      target="_blank"
      rel="noreferrer"
      title="What this check looks for, and how to fix it"
    >
      {checkID}
    </a>
  );
}
