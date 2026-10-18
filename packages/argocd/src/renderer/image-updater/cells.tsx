import { applicationsCell, watchedStatus } from "../api/image-updater/image-updater-tables";
import type { TrackedImage } from "../api/image-updater/image-updates";
import { formatAge } from "../api/image-updater/rule-health";
import { RowDrawerLink } from "../components/drawer-link";

export function ago(timestamp: string | undefined, now: number): string {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  return Number.isNaN(parsed) ? "never" : `${formatAge(now - parsed)} ago`;
}

export function ApplicationChips({
  image,
  onOpen,
}: {
  image: TrackedImage;
  onOpen: (name: string) => void;
}) {
  if (image.applications.length === 0) return <span className="ArgoCD-muted">none</span>;

  return (
    <div className="ArgoCD-chips">
      {image.applications.map((watched) => (
        <button
          key={watched.name}
          type="button"
          className="ArgoCD-chip"
          title={
            watched.skipped
              ? `Skipped: ${watched.skipped}. Opens it in the Applications list`
              : "Opens it in the Applications list"
          }
          onClick={() => onOpen(watched.name)}
        >
          <span>{watched.name}</span>
          <span className="ArgoCD-chip__meta">{watchedStatus(watched)}</span>
        </button>
      ))}
    </div>
  );
}

export function StateNote({ note, alarm }: { note?: string; alarm: boolean }) {
  if (!note) return null;

  return (
    <p className={`ArgoCD-page__subline${alarm ? " ArgoCD-page__subline--alarm" : ""}`}>{note}</p>
  );
}

// Prevented, or the drawer's outside-click listener closes it as it opens.
export function opening(open: () => void) {
  return (event: { preventDefault(): void }) => {
    event.preventDefault();
    open();
  };
}

export function ApplicationLinks({
  image,
  onOpen,
}: {
  image: TrackedImage;
  onOpen: (name: string) => void;
}) {
  const cell = applicationsCell(image);

  if (cell.kind === "none") return <span className="ArgoCD-muted">none</span>;

  if (cell.kind === "many") {
    return (
      <span title={cell.title}>
        <b>{cell.count}</b> Applications
      </span>
    );
  }

  const { watched } = cell;

  return (
    <span title={watched.skipped ? `Skipped: ${watched.skipped}` : undefined}>
      <RowDrawerLink
        label={watched.name}
        title="Opens it in the Applications list"
        onOpen={() => onOpen(watched.name)}
      />
      <span className="ArgoCD-muted"> {watchedStatus(watched)}</span>
    </span>
  );
}
