import type { ReactNode } from "react";

// Inside a drawer: unprevented, the click counts as outside it. The caller closes the drawer first.
export function DrawerLink({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="CertManager-link"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
