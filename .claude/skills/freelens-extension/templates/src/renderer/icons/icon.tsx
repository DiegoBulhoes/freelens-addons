import type React from "react";

// A plain glyph of our own. Not the project's logo: a trademark in a sidebar is
// someone else's mark on our work, and the shape only has to be recognisable.
export function __Name__Icon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role="img" {...props}>
      <title>__TITLE__</title>
      <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.6 3.7L12 11.7 5.4 8 12 4.3ZM5 9.7l6 3.3v6.7l-6-3.3V9.7Zm8 10v-6.7l6-3.3v6.7l-6 3.3Z" />
    </svg>
  );
}
