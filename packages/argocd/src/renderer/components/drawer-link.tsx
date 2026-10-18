/** Prevented, so the drawer it opens is not closed by this click. */
export function DrawerLink({
  label,
  title,
  onOpen,
}: {
  label: string;
  title: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="ArgoCD-link"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      {label}
    </button>
  );
}

/** Also stopped, so the row under it does not open its own drawer instead. */
export function RowDrawerLink({
  label,
  title,
  onOpen,
}: {
  label: string;
  title: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="ArgoCD-link"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onOpen();
      }}
    >
      {label}
    </button>
  );
}
