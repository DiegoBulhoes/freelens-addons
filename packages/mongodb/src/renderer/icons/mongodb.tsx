import type React from "react";

// Our own glyph, never the project's logo: that is someone else's trademark.
export function MongoDBIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role="img" {...props}>
      <title>MongoDB</title>
      <path d="M12 2C7.6 2 4 3.3 4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5c0-1.7-3.6-3-8-3Zm6 17c0 .5-2.1 1-6 1s-6-.5-6-1v-2.2c1.6.8 3.7 1.2 6 1.2s4.4-.4 6-1.2V19Zm0-4.5c0 .5-2.1 1-6 1s-6-.5-6-1v-2.2c1.6.8 3.7 1.2 6 1.2s4.4-.4 6-1.2v2.2ZM12 11c-3.9 0-6-.5-6-1V7.8C7.6 8.6 9.7 9 12 9s4.4-.4 6-1.2V10c0 .5-2.1 1-6 1Zm0-4c-3.9 0-6-.5-6-1s2.1-1 6-1 6 .5 6 1-2.1 1-6 1Z" />
    </svg>
  );
}
