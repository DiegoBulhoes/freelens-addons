import { formatAge, type TrackedImage } from "../api/image-updates";

export function ago(timestamp: string | undefined, now: number): string {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  return Number.isNaN(parsed) ? "never" : `${formatAge(now - parsed)} ago`;
}

export function describeChoice(image: TrackedImage): string {
  const within = image.constraint ? ` within ${image.constraint}` : "";
  const tags = image.allowTags ? `, tags matching ${image.allowTags}` : "";

  return `${image.strategy}${within}${tags}`;
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
          <span className="ArgoCD-chip__meta">
            {watched.skipped ? "skipped" : (watched.running ?? "not running it")}
          </span>
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
  if (image.applications.length === 0) return <span className="ArgoCD-muted">none</span>;

  return (
    <>
      {image.applications.map((watched, index) => (
        <span
          key={watched.name}
          title={watched.skipped ? `Skipped: ${watched.skipped}` : undefined}
        >
          {index > 0 && ", "}
          <button
            type="button"
            className="ArgoCD-link"
            title="Opens it in the Applications list"
            onClick={(event) => {
              // A link in a row that opens a drawer navigates instead.
              event.stopPropagation();
              onOpen(watched.name);
            }}
          >
            {watched.name}
          </button>
          <span className="ArgoCD-muted">
            {" "}
            {watched.skipped ? "skipped" : (watched.running ?? "not running it")}
          </span>
        </span>
      ))}
    </>
  );
}
