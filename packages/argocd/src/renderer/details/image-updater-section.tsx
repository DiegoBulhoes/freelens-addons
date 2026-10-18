import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import type { Application } from "../api/applications/application";
import { ImageUpdater } from "../api/image-updater/image-updater";
import { imagesForApplication } from "../api/image-updater/image-updates";
import { formatAge, ruleHealth } from "../api/image-updater/rule-health";
import { hasImageUpdater } from "../api/shared/installed";
import { DrawerLink } from "../components/drawer-link";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "../hooks/load-stores";

const {
  Component: { DrawerItem, DrawerTitle },
  K8sApi: { crdStore },
} = Renderer;

type OpenRule = (name: string, namespace: string) => void;

function RulesFor({ application, onOpenRule }: { application: Application; onOpenRule: OpenRule }) {
  const store = useKubeStore(() => ImageUpdater.getStore<ImageUpdater>());

  useLoadedStores([{ kind: "ImageUpdater", store }]);

  const updaters = (store?.items ?? []) as ImageUpdater[];
  const images = imagesForApplication(application, updaters);

  if (images.length === 0) return null;

  const now = Date.now();

  return (
    <>
      <DrawerTitle>Image Updater</DrawerTitle>
      {images.map((image) => {
        const updater = updaters.find(
          (candidate) =>
            candidate.getName() === image.updater && candidate.getNs() === image.namespace,
        );
        const health = updater ? ruleHealth(updater, [application], now) : undefined;
        const watched = image.applications[0];

        return (
          <DrawerItem key={`${image.updater}/${image.alias}`} name={image.alias}>
            <div>
              <div>
                <code>{image.repository}</code>
                {watched?.running && (
                  <span className="ArgoCD-muted"> running {watched.running}</span>
                )}
              </div>
              <div className="ArgoCD-muted">
                {image.strategy}
                {image.constraint && ` within ${image.constraint}`}, written to {image.writeBack},
                by rule{" "}
                <DrawerLink
                  label={image.updater}
                  title="Opens the rule"
                  onOpen={() => onOpenRule(image.updater, image.namespace)}
                />
              </div>
              {watched?.skipped ? (
                <div className="ArgoCD-text--warning">Skipped: {watched.skipped}.</div>
              ) : (
                health &&
                health.tone !== "ok" && (
                  <div className={`ArgoCD-text--${health.tone}`}>{health.reason}</div>
                )
              )}
              {updater?.status?.lastCheckedAt && (
                <div className="ArgoCD-muted">
                  Checked {formatAge(now - Date.parse(updater.status.lastCheckedAt))} ago
                </div>
              )}
            </div>
          </DrawerItem>
        );
      })}
    </>
  );
}

export const ImageUpdaterSection = observer(
  ({ application, onOpenRule }: { application: Application; onOpenRule: OpenRule }) => {
    if (!hasImageUpdater(crdStore.items.map((crd) => crd.getName()))) return null;

    return <RulesFor application={application} onOpenRule={onOpenRule} />;
  },
);
