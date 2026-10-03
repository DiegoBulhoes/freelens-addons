import { checkLink } from "../api/check-link";

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
