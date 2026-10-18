import { keepDrawerOpen } from "../api/shared/drawer-click";

export function ShowAll({
  hidden,
  total,
  what,
  onShowAll,
}: {
  hidden: number;
  total: number;
  what: string;
  onShowAll: () => void;
}) {
  if (hidden === 0) return null;

  return (
    <p className="Trivy-section__note">
      and {hidden} more {what}.{" "}
      <button
        type="button"
        className="Trivy-link"
        title={`Lists all ${total} ${what} here`}
        onClick={(event) => keepDrawerOpen(event, onShowAll)}
      >
        Show all {total}
      </button>
    </p>
  );
}
