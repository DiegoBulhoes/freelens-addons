import type { ReactNode } from "react";
import type { OpenPage } from "../api/overview/attention";
import { openHostList } from "../api/shared/actions";
import type { LinkTarget } from "../api/shared/facts";
import { hostListOf } from "../api/shared/host-links";

/** Closes the drawer, then opens the drawer or the list `to` names. */
export function followLink(to: LinkTarget, onClose: () => void, open?: OpenPage): void {
  onClose();
  if ("page" in to) open?.(to.page, { kind: to.kind, namespace: to.namespace, name: to.name });
  else openHostList(hostListOf(to.host, to.name));
}

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
      className="Prometheus-link"
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
