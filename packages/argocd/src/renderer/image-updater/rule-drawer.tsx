import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

import type { Application } from "../api/application";
import { copyToClipboard } from "../api/cli";
import type { ImageUpdater } from "../api/image-updater";
import { findControllerNamespace, openControllerLogs } from "../api/image-updater-actions";
import { locateImages, ruleCommands } from "../api/image-updater-patches";
import { type RuleHealth, recentUpdates, trackedImages } from "../api/image-updates";
import { ObjectDrawer } from "../components/object-drawer";
import { confirmDelete, confirmEditImage, confirmUndo } from "./dialogs";
import { ApplicationChips, ago, describeChoice } from "./shared";

const {
  Component: { Notifications, WithTooltip },
} = Renderer;

async function showControllerLogs() {
  if ((await openControllerLogs()) === "no-pods") {
    Notifications.error("No pod of the Image Updater controller was found by its labels.");
  }
}

async function copy(label: string, text: string) {
  try {
    await copyToClipboard(text);
    Notifications.ok(`${label} copied.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not copy ${label.toLowerCase()}`);
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
    const [controllerNamespace, setControllerNamespace] = useState<string>();
    const namespace = updater?.getNs();

    useEffect(() => {
      if (!namespace) return;

      let cancelled = false;

      void findControllerNamespace(namespace).then((found) => {
        if (!cancelled) setControllerNamespace(found);
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
                  {updates.map((update) => (
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
                      </span>
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
                    </div>
                  ))}
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
                        <span className="ArgoCD-mono">{describeChoice(image)}</span>
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

            <section className="ArgoCD-section" data-section="image-updater-commands">
              <h3 className="ArgoCD-section__title">Look further</h3>
              <div className="ArgoCD-list">
                {ruleCommands(updater, controllerNamespace ?? updater.getNs() ?? "argocd").map(
                  ({ label, command }) => (
                    <div key={label} className="ArgoCD-row">
                      <span className="ArgoCD-row__main">
                        <span className="ArgoCD-row__name">{label}</span>
                        <code className="ArgoCD-row__reason">{command}</code>
                      </span>
                      <span className="ArgoCD-row__actions">
                        <WithTooltip tooltip="Copies the command, to paste into a terminal">
                          <button
                            type="button"
                            className="ArgoCD-button"
                            onClick={() => void copy(label, command)}
                          >
                            Copy
                          </button>
                        </WithTooltip>
                      </span>
                    </div>
                  ),
                )}
              </div>
            </section>
          </>
        )}
      </ObjectDrawer>
    );
  },
);
