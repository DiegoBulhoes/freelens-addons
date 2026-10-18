import type { ReactNode } from "react";
import { type HostKind, hostListOf } from "../api/shared/host-links";
import type { OpenPage } from "../api/shared/navigation";
import { openHostList } from "../api/writes/actions";

/** Closes the drawer, then opens a page of ours on a drawer or a list. */
export function followPage(onClose: () => void, open: OpenPage, ...to: Parameters<OpenPage>) {
  onClose();
  open(...to);
}

/** Closes the drawer, then opens the host's list searched by the name. */
export function followHost(onClose: () => void, kind: HostKind, name: string) {
  onClose();
  openHostList(hostListOf(kind, name));
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
      className="CNPG-link"
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

// The row opens a drawer; this link goes to its target instead.
export function CellLink({
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
      className="CNPG-link"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
