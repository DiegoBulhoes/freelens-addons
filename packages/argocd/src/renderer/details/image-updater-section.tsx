import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import type { Application } from "../api/application";
import { ImageUpdater } from "../api/image-updater";
import { formatAge, imagesForApplication, ruleHealth } from "../api/image-updates";
import { hasImageUpdater } from "../api/installed";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "../hooks/load-stores";

const {
  Component: { DrawerItem, DrawerTitle },
  K8sApi: { crdStore },
} = Renderer;

function RulesFor({ application }: { application: Application }) {
  const store = useKubeStore(() => ImageUpdater.getStore<ImageUpdater>());

  useLoadedStores([store]);

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
                by rule {image.updater}
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

export const ImageUpdaterSection = observer(({ application }: { application: Application }) => {
  if (!hasImageUpdater(crdStore.items.map((crd) => crd.getName()))) return null;

  return <RulesFor application={application} />;
});
