import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

const {
  Navigation: { navigate },
} = Renderer;

// Closes the drawer before the page under it changes; unprevented, the click counts as outside it.
export function DrawerLink({
  title,
  path,
  onLeave,
  children,
}: {
  title: string;
  path?: string;
  onLeave: () => void;
  children: ReactNode;
}) {
  if (!path) return <>{children}</>;

  return (
    <button
      type="button"
      className="Trivy-link"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        onLeave();
        navigate(path);
      }}
    >
      {children}
    </button>
  );
}
