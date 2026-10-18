import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

import type { Application } from "../api/applications/application";
import type { ImageUpdater } from "../api/image-updater/image-updater";
import {
  type ControllerRef,
  controllerOf,
  ruleCommands,
} from "../api/image-updater/image-updater-controller";
import { undoRefusal } from "../api/image-updater/image-updater-details";
import { describePicks } from "../api/image-updater/image-updater-tables";
import { recentUpdates, trackedImages } from "../api/image-updater/image-updates";
import type { RuleHealth } from "../api/image-updater/rule-health";
import { findController, openControllerLogs } from "../api/writes/image-updater-actions";
import { locateImages } from "../api/writes/image-updater-patches";
import { CommandsSection } from "../components/commands-section";
import { ObjectDrawer } from "../components/object-drawer";
import { ApplicationChips, ago } from "./cells";
import { confirmDelete, confirmEditImage, confirmUndo } from "./dialogs";

const {
  Component: { Notifications, WithTooltip },
} = Renderer;

async function showControllerLogs() {
  try {
    if ((await openControllerLogs()) === "no-pods") {
      Notifications.error("No pod of the Image Updater controller was found by its labels.");
    }
  } catch (error) {
    Notifications.checkedError(error, "Could not list the Image Updater controller's pods");
  }
}

interface RuleDrawerProps {
  updater?: ImageUpdater;
  health?: RuleHealth;
  applications: Application[];
  onClose: () => void;
  onOpenApplication: (name: string) => void;
}

export const RuleDrawer = observer(
  ({ updater, health, applications, onClose, onOpenApplication }: RuleDrawerProps) => {
    const [controller, setController] = useState<ControllerRef>();
    const namespace = updater?.getNs();

    useEffect(() => {
      if (!namespace) return;

      let cancelled = false;

      void findController(namespace).then((found) => {
        if (!cancelled) setController(found);
      });

      return () => {
        cancelled = true;
      };
    }, [namespace]);

    const now = Date.now();
    const images = updater ? trackedImages([updater], applications) : [];
    const updates = updater ? recentUpdates([updater]) : [];
    const open = Boolean(updater && health);

    return (
      <ObjectDrawer
        open={open}
        kind="ImageUpdater"
        name={updater?.getName() ?? ""}
        onClose={onClose}
        state={health}
        section="image-updater-rule"
        actions={
          updater
            ? [
                {
                  icon: "subject",
                  title: "Opens the Image Updater controller's log",
                  onClick: () => void showControllerLogs(),
                },
                {
                  icon: "delete",
                  title: "Deletes the rule. Asks you to type its name",
                  onClick: () => confirmDelete(updater, onClose),
                },
              ]
            : []
        }
      >
        {updater && (
          <>
            <dl className="ArgoCD-facts">
              <dt>Namespace</dt>
              <dd>{updater.getNs()}</dd>
              <dt>Applications</dt>
              <dd>{updater.status?.applicationsMatched ?? "—"}</dd>
              <dt>Images</dt>
              <dd>{updater.status?.imagesManaged ?? "—"}</dd>
              <dt>Checked</dt>
              <dd>{ago(updater.status?.lastCheckedAt, now)}</dd>
              <dt>Last update</dt>
              <dd>{ago(updater.status?.lastUpdatedAt, now)}</dd>
            </dl>

            <section className="ArgoCD-section" data-section="image-updater-updates">
              <h3 className="ArgoCD-section__title">Last update</h3>
              {updates.length === 0 ? (
                <p className="ArgoCD-section__note">Nothing updated since the rule was created.</p>
              ) : (
                <div className="ArgoCD-list">
                  {updates.map((update) => {
                    const refusal = undoRefusal(update, updater, applications);

                    return (
                      <div key={`${update.alias}/${update.to}`} className="ArgoCD-row">
                        <span className="ArgoCD-row__main">
                          <span className="ArgoCD-row__name">
                            <b>{update.alias}</b>
                            <span className="ArgoCD-row__meta">{update.image}</span>
                          </span>
                          <span className="ArgoCD-row__reason ArgoCD-mono">
                            {update.from ?? "?"} → {update.to}, on {update.applications} Application
                            {update.applications === 1 ? "" : "s"}, {ago(update.at, now)}
                          </span>
                          {refusal && (
                            <span className="ArgoCD-row__reason">No Undo here: {refusal}</span>
                          )}
                        </span>
                        {!refusal && (
                          <span className="ArgoCD-row__actions">
                            <WithTooltip tooltip="Puts the previous tag back on the Applications and keeps it there. Asks first">
                              <button
                                type="button"
                                className="ArgoCD-button ArgoCD-button--caution"
                                onClick={() => confirmUndo(updater, update, applications)}
                              >
                                Undo
                              </button>
                            </WithTooltip>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="ArgoCD-hint">
                The controller keeps only the most recent update, not a history.
              </p>
            </section>

            <section className="ArgoCD-section" data-section="image-updater-images">
              <h3 className="ArgoCD-section__title">Images</h3>
              {images.length === 0 ? (
                <p className="ArgoCD-section__note">This rule names no image.</p>
              ) : (
                images.map((image) => {
                  const [location] = locateImages(updater, image.alias);

                  return (
                    <section
                      key={`${image.alias}/${image.applications.map((each) => each.name).join(",")}`}
                      className="ArgoCD-box"
                    >
                      <div className="ArgoCD-box__head">
                        <span className="ArgoCD-box__title">
                          <b>{image.alias}</b>
                          <span className="ArgoCD-box__meta">{image.repository}</span>
                        </span>
                      </div>
                      <p className="ArgoCD-box__reason">
                        <span className="ArgoCD-mono">{describePicks(image)}</span>
                        {". Written to "}
                        {image.writeBack}
                        {image.fromAnnotations && ", configured in the Application's annotations"}.
                      </p>
                      <ApplicationChips image={image} onOpen={onOpenApplication} />
                      {location && !image.fromAnnotations && (
                        <div className="ArgoCD-actions">
                          <WithTooltip tooltip="Changes the constraint, the strategy and the allowed tags. Asks first">
                            <button
                              type="button"
                              className="ArgoCD-button"
                              onClick={() => confirmEditImage(updater, location)}
                            >
                              Edit
                            </button>
                          </WithTooltip>
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </section>

            <CommandsSection
              commands={ruleCommands(
                updater,
                controller ?? controllerOf([], updater.getNs() ?? "argocd"),
              )}
              section="image-updater-commands"
            />
          </>
        )}
      </ObjectDrawer>
    );
  },
);
