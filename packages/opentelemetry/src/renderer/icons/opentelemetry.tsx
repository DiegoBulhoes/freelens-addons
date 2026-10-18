import type React from "react";

// Our own glyph, never the project's logo: that is someone else's trademark.
export function OpenTelemetryIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role="img" {...props}>
      <title>OpenTelemetry</title>
      <path
        d="M6 8.5 17 10M7 9l3.5 8.5M17.5 11.5 12 17.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="6" cy="7" r="3" />
      <circle cx="18.5" cy="10" r="2.5" />
      <circle cx="10.5" cy="19" r="2.5" />
    </svg>
  );
}
