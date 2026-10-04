import { observer } from "mobx-react";

import type { Application } from "../api/application";
import type { ImageUpdater } from "../api/image-updater";
import {
  applicationsOfUpdate,
  editTarget,
  imageState,
  undoPreview,
  updateState,
} from "../api/image-updater-details";
import type { TrackedImage, UpdateRow, WatchedApplication } from "../api/image-updates";
import { ObjectDrawer } from "../components/object-drawer";
import { confirmEditImage, confirmUndo } from "./dialogs";
import { ago } from "./shared";

/** Prevented, so the drawer it opens is not closed by this click. */
function DrawerLink({
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

function ApplicationRows({
  applications,
  newTag,
  onOpen,
}: {
  applications: WatchedApplication[];
  newTag?: string;
  onOpen: (name: string) => void;
}) {
  if (applications.length === 0) {
    return (
      <p className="ArgoCD-section__note">No Application in the namespace matches its rule.</p>
    );
  }

  return (
    <div className="ArgoCD-list">
      {applications.map((watched) => (
        <div key={watched.name} className="ArgoCD-row">
          <span className="ArgoCD-row__main">
            <span className="ArgoCD-row__name">
              <DrawerLink
                label={watched.name}
                title="Opens it in the Applications list"
                onOpen={() => onOpen(watched.name)}
              />
            </span>
            <span className="ArgoCD-row__reason">
              {watched.skipped
                ? `Skipped: ${watched.skipped}.`
                : watched.running === undefined
                  ? "Does not run this image."
                  : newTag === undefined
                    ? "The tag it runs now."
                    : watched.running === newTag
                      ? "Runs the tag this update set."
                      : "Runs another tag now."}
            </span>
          </span>
          {watched.running !== undefined && (
            <span className="ArgoCD-row__aside ArgoCD-mono">{watched.running}</span>
          )}
        </div>
      ))}
    </div>
  );
}

interface ImageDrawerProps {
  image?: TrackedImage;
  rule?: ImageUpdater;
  onClose: () => void;
  onOpenRule: () => void;
  onOpenApplication: (name: string) => void;
}

export const ImageDrawer = observer(
  ({ image, rule, onClose, onOpenRule, onOpenApplication }: ImageDrawerProps) => {
    const target = image ? editTarget(image, rule) : undefined;

    return (
      <ObjectDrawer
        open={Boolean(image)}
        kind="Image"
        name={image?.alias ?? ""}
        onClose={onClose}
        state={image ? imageState(image) : undefined}
        section="image-updater-image"
        actions={
          rule && target && "location" in target
            ? [
                {
                  icon: "edit",
                  title: "Changes the constraint, the strategy and the allowed tags. Asks first",
                  onClick: () => confirmEditImage(rule, target.location),
                },
              ]
            : []
        }
      >
        {image && (
          <>
            <dl className="ArgoCD-facts">
              <dt>Namespace</dt>
              <dd>{image.namespace}</dd>
              <dt>Repository</dt>
              <dd className="ArgoCD-mono">{image.repository}</dd>
              <dt>Strategy</dt>
              <dd>{image.strategy}</dd>
              <dt>Constraint</dt>
              <dd className="ArgoCD-mono">{image.constraint ?? "any tag"}</dd>
              <dt>Allowed tags</dt>
              <dd className="ArgoCD-mono">{image.allowTags ?? "all"}</dd>
              {image.ignoreTags && image.ignoreTags.length > 0 && (
                <>
                  <dt>Ignored tags</dt>
                  <dd className="ArgoCD-mono">{image.ignoreTags.join(", ")}</dd>
                </>
              )}
              <dt>Writes to</dt>
              <dd>{image.writeBack}</dd>
              <dt>Settings in</dt>
              <dd>{image.fromAnnotations ? "the Application's annotations" : "the rule"}</dd>
              <dt>Rule</dt>
              <dd>
                <DrawerLink label={image.updater} title="Opens its rule" onOpen={onOpenRule} />
              </dd>
            </dl>

            {target && "reason" in target && <p className="ArgoCD-hint">{target.reason}</p>}

            <section className="ArgoCD-section" data-section="image-updater-image-applications">
              <h3 className="ArgoCD-section__title">Applications it reaches</h3>
              <ApplicationRows applications={image.applications} onOpen={onOpenApplication} />
            </section>
          </>
        )}
      </ObjectDrawer>
    );
  },
);

interface UpdateDrawerProps {
  update?: UpdateRow;
  rule?: ImageUpdater;
  images: TrackedImage[];
  applications: Application[];
  onClose: () => void;
  onOpenRule: () => void;
  onOpenApplication: (name: string) => void;
}

export const UpdateDrawer = observer(
  ({
    update,
    rule,
    images,
    applications,
    onClose,
    onOpenRule,
    onOpenApplication,
  }: UpdateDrawerProps) => {
    const now = Date.now();

    return (
      <ObjectDrawer
        open={Boolean(update)}
        kind="Image update"
        name={update ? `${update.alias} → ${update.to}` : ""}
        onClose={onClose}
        state={update ? updateState(update, undoPreview(update, rule, applications)) : undefined}
        section="image-updater-update"
        actions={
          update && rule
            ? [
                {
                  icon: "undo",
                  title:
                    "Puts the previous tag back on the Applications and keeps it there. Asks first",
                  onClick: () => confirmUndo(rule, update, applications),
                },
              ]
            : []
        }
      >
        {update && (
          <>
            <dl className="ArgoCD-facts">
              <dt>Namespace</dt>
              <dd>{update.namespace}</dd>
              <dt>Image</dt>
              <dd>
                {update.alias}
                <span className="ArgoCD-muted ArgoCD-mono"> · {update.image}</span>
              </dd>
              <dt>From</dt>
              <dd className="ArgoCD-mono">{update.from ?? "not recorded"}</dd>
              <dt>To</dt>
              <dd className="ArgoCD-mono">{update.to}</dd>
              <dt>When</dt>
              <dd>
                {update.at} <span className="ArgoCD-muted">({ago(update.at, now)})</span>
              </dd>
              <dt>Applications updated</dt>
              <dd>{update.applications}</dd>
              <dt>Rule</dt>
              <dd>
                <DrawerLink label={update.updater} title="Opens its rule" onOpen={onOpenRule} />
              </dd>
            </dl>

            <section className="ArgoCD-section" data-section="image-updater-update-applications">
              <h3 className="ArgoCD-section__title">Applications its rule reaches</h3>
              <ApplicationRows
                applications={applicationsOfUpdate(update, images)}
                newTag={update.to}
                onOpen={onOpenApplication}
              />
            </section>
          </>
        )}
      </ObjectDrawer>
    );
  },
);
