import type { ReactNode } from "react";

import { checkLink } from "../api/vulnerabilities/check-link";

export function CheckLink({
  checkID,
  className = "Trivy-row__aside",
  fallback = null,
}: {
  checkID: string | undefined;
  className?: string;
  fallback?: ReactNode;
}) {
  const href = checkLink(checkID);

  if (!href) return <>{fallback}</>;

  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      title="What this check looks for, and how to fix it"
    >
      {checkID}
    </a>
  );
}
