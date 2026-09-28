import type React from "react";

// A certificate with a seal, drawn here — deliberately not cert-manager's logo,
// and not a shield, which is what the Trivy group in the same sidebar uses.
export function CertManagerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role="img" {...props}>
      <title>cert-manager</title>
      <path d="M4 3h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-3v-2h2V5H5v9h4v2H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 4h10v2H7V7Zm0 3h5v2H7v-2Zm7 1.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-2.5 5.2 1 .4V22l1.5-1 1.5 1v-2.9l1-.4V23l-2.5-1.6L11.5 23v-3.3Z" />
    </svg>
  );
}
