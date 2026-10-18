import type React from "react";

// Our own glyph, never the project's logo: that is someone else's trademark.
export function PrometheusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role="img" {...props}>
      <title>Prometheus</title>
      <path
        d="M3 3v18h18M6.5 15.5l4-5 3.5 3 5-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="6.5" r="2.2" />
    </svg>
  );
}
