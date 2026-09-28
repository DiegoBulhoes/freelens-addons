import type React from "react";

// A plain shield glyph, deliberately not the Aqua Security or Trivy trademark.
export function TrivyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role="img" {...props}>
      <title>Trivy</title>
      <path d="M12 2 4 5v6.5c0 4.6 3.4 8.9 8 10.5 4.6-1.6 8-5.9 8-10.5V5l-8-3Zm0 2.1 6 2.3v5.1c0 3.6-2.5 7-6 8.4-3.5-1.4-6-4.8-6-8.4V6.4l6-2.3Zm-1 3.4v5h2v-5h-2Zm0 6.5v2h2v-2h-2Z" />
    </svg>
  );
}
