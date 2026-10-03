import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { Application, shortenRevision } from "../api/application";
import { wasForced } from "../api/patches";
import type { ApplicationSource, ResourceStatus } from "../api/types";
import { HealthBadge, SyncBadge } from "../components/status";
import { ArgoCDStyles } from "../components/styles";
import { ImageUpdaterSection } from "./image-updater-section";

const {
  Component: { DrawerItem, DrawerTitle, Table, TableCell, TableHead, TableRow },
  Navigation: { showDetails },
  K8sApi: { apiManager },
} = Renderer;

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return "—";

  const parsed = Date.parse(timestamp);

  return Number.isNaN(parsed) ? timestamp : new Date(parsed).toLocaleString();
}

function describeSource(source: ApplicationSource): string {
  const target = source.chart
    ? `chart ${source.chart}`
    : source.path && source.path !== "."
      ? source.path
      : "repository root";
  const revision = source.targetRevision ? ` @ ${source.targetRevision}` : "";

  return `${target}${revision}`;
}

/** The API path showDetails takes, not a details URL. */
function selfLinkFor(resource: ResourceStatus): string | undefined {
  const { group, version, kind, name, namespace } = resource;

  if (!kind || !name || !version) return undefined;

  const apiVersion = group ? `${group}/${version}` : version;
  const api = apiManager.getApiByKind(kind, apiVersion);

  if (!api) return undefined;

  return api.formatUrlForNotListing({ name, namespace });
}

function ManagedResources({ application }: { application: Application }) {
  const resources = Application.getManagedResources(application);

  if (resources.length === 0) {
    return <DrawerItem name="Managed resources">none reported yet</DrawerItem>;
  }

  return (
    <>
      <DrawerTitle>Managed resources ({resources.length})</DrawerTitle>
      <Table selectable scrollable={false}>
        <TableHead sticky={false}>
          <TableCell>Kind</TableCell>
          <TableCell>Name</TableCell>
          <TableCell>Namespace</TableCell>
          <TableCell>Sync</TableCell>
          <TableCell>Health</TableCell>
        </TableHead>
        {resources.map((resource) => {
          const selfLink = selfLinkFor(resource);

          return (
            <TableRow
              key={`${resource.kind}/${resource.namespace}/${resource.name}`}
              nowrap
              onClick={selfLink ? () => showDetails(selfLink) : undefined}
            >
              <TableCell>{resource.kind}</TableCell>
              <TableCell>{resource.name}</TableCell>
              <TableCell>{resource.namespace ?? "—"}</TableCell>
              <TableCell>
                {resource.status ? <SyncBadge status={resource.status} /> : "—"}
              </TableCell>
              <TableCell>
                {resource.health?.status ? (
                  <HealthBadge status={resource.health.status} message={resource.health.message} />
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </Table>
    </>
  );
}

function LastSync({ application }: { application: Application }) {
  const operation = application.status?.operationState;

  if (!operation) return null;

  const initiator = operation.operation?.initiatedBy;
  const by = initiator?.automated ? "automated" : (initiator?.username ?? "unknown");

  return (
    <>
      <DrawerTitle>Last sync</DrawerTitle>
      <DrawerItem name="Result">{operation.phase ?? "—"}</DrawerItem>
      {operation.message && <DrawerItem name="Message">{operation.message}</DrawerItem>}
      <DrawerItem name="Started">{formatTime(operation.startedAt)}</DrawerItem>
      <DrawerItem name="Finished">{formatTime(operation.finishedAt)}</DrawerItem>
      <DrawerItem name="Initiated by">{by}</DrawerItem>
      {operation.operation?.sync?.prune !== undefined && (
        <DrawerItem name="Prune">{String(operation.operation.sync.prune)}</DrawerItem>
      )}
      {wasForced(operation.operation?.sync) && <DrawerItem name="Force">true</DrawerItem>}
    </>
  );
}

function History({ application }: { application: Application }) {
  const history = application.status?.history;

  if (!history || history.length === 0) return null;

  // ArgoCD appends to status.history, so it arrives oldest-first.
  const entries = [...history].reverse().slice(0, 10);

  return (
    <>
      <DrawerTitle>Deploy history</DrawerTitle>
      <Table scrollable={false}>
        <TableHead sticky={false}>
          <TableCell>Deployed</TableCell>
          <TableCell>Revision</TableCell>
          <TableCell>By</TableCell>
        </TableHead>
        {entries.map((entry) => {
          const revisions = entry.revisions ?? (entry.revision ? [entry.revision] : []);

          return (
            <TableRow key={entry.id ?? entry.deployedAt} nowrap>
              <TableCell>{formatTime(entry.deployedAt)}</TableCell>
              <TableCell>
                <code>{revisions.map(shortenRevision).join(", ") || "—"}</code>
              </TableCell>
              <TableCell>
                {entry.initiatedBy?.automated ? "automated" : (entry.initiatedBy?.username ?? "—")}
              </TableCell>
            </TableRow>
          );
        })}
      </Table>
    </>
  );
}

export const ApplicationDetails = observer(
  ({ object }: Renderer.Component.KubeObjectDetailsProps<Application>) => {
    if (!object) return null;

    const sources = Application.getSources(object);
    const conditions = object.status?.conditions ?? [];
    const images = Application.getImages(object);

    return (
      <div className="ArgoCD ArgoCDApplicationDetails">
        <ArgoCDStyles />
        <DrawerItem name="Destination">{Application.getDestination(object)}</DrawerItem>
        {Application.getHealthMessage(object) && (
          <DrawerItem name="Health message">{Application.getHealthMessage(object)}</DrawerItem>
        )}
        <DrawerItem name="Auto-sync">
          {Application.isAutoSynced(object)
            ? object.spec.syncPolicy?.automated?.selfHeal
              ? "enabled, self-healing"
              : "enabled"
            : "disabled: drift stays until someone syncs"}
        </DrawerItem>
        <DrawerItem name="Last reconciled">{formatTime(object.status?.reconciledAt)}</DrawerItem>

        <DrawerTitle>Sources ({sources.length})</DrawerTitle>
        {sources.map((source, index) => (
          <DrawerItem
            // Sources have no id of their own; two can share a repoURL at different paths.
            key={`${source.repoURL}-${source.path ?? source.chart ?? index}`}
            name={source.ref ? `$${source.ref}` : `Source ${index + 1}`}
          >
            <div>
              <div>{source.repoURL}</div>
              <div style={{ opacity: 0.7 }}>{describeSource(source)}</div>
            </div>
          </DrawerItem>
        ))}

        <LastSync application={object} />

        {conditions.length > 0 && (
          <>
            <DrawerTitle>Conditions</DrawerTitle>
            {conditions.map((condition) => (
              <DrawerItem
                key={`${condition.type}-${condition.lastTransitionTime}`}
                name={condition.type ?? "Condition"}
              >
                {condition.message ?? "—"}
              </DrawerItem>
            ))}
          </>
        )}

        <ManagedResources application={object} />

        {images.length > 0 && (
          <>
            <DrawerTitle>Images</DrawerTitle>
            {images.map((image) => (
              <DrawerItem key={image} name="">
                <code>{image}</code>
              </DrawerItem>
            ))}
          </>
        )}

        <ImageUpdaterSection application={object} />

        <History application={object} />
      </div>
    );
  },
);
