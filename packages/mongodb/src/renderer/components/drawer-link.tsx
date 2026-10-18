import type { ReactNode } from "react";
import { HOST_LIST_TITLES, type HostKind, hostListOf } from "../api/shared/host-links";
import { openHostList } from "../api/writes/actions";

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
      className="MongoDB-link"
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

/** Closes the drawer and opens the host's list searched by the name; shows the name unless given a label. */
export function HostLink({
  kind,
  name,
  label,
  onClose,
}: {
  kind: HostKind;
  name: string;
  label?: string;
  onClose: () => void;
}) {
  return (
    <DrawerLink
      title={HOST_LIST_TITLES[kind]}
      onClick={() => {
        onClose();
        openHostList(hostListOf(kind, name));
      }}
    >
      {label ?? name}
    </DrawerLink>
  );
}
