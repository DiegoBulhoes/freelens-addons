import type React from "react";

// Our own glyph, never the project's logo: that is someone else's trademark.
export function RedisIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role="img" {...props}>
      <title>Redis</title>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Zm-9 7.3V13l9 4.5 9-4.5v-2.7l-9 4.5-9-4.5Zm0 5.5v2.7L12 23l9-4.5v-2.7l-9 4.5-9-4.5Z" />
    </svg>
  );
}
