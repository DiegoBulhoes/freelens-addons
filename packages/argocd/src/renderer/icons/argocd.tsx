import type React from "react";

// Deliberately a plain glyph, not the ArgoCD trademark.
export function ArgoCDIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role="img" {...props}>
      <title>ArgoCD</title>
      <path d="M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.2 6.8 3.4L12 11 5.2 7.6 12 4.2ZM4.8 9.2 11 12.3v7L4.8 16.2v-7Zm8.2 10.1v-7l6.2-3.1v7L13 19.3Z" />
    </svg>
  );
}
