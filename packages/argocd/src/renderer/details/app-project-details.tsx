import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { Application } from "../api/applications/application";
import {
  describeRoles,
  describeWindows,
  kindRules,
  knownCount,
  projectState,
} from "../api/applications/drawers";
import { AppProject } from "../api/projects/app-project";
import {
  describeLoadState,
  emptyText,
  loadedForScope,
  loadState,
  refusedEverywhere,
} from "../api/shared/store-state";
import { DrawerLink } from "../components/drawer-link";
import { StateBanner } from "../components/state-banner";
import { HealthBadge, SyncBadge } from "../components/status";
import { ArgoCDStyles } from "../components/styles";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "../hooks/load-stores";
import { openProjectApplications } from "../pages/applications-page";

const {
  Component: { DrawerItem, DrawerTitle, Table, TableCell, TableHead, TableRow },
  Navigation: { showDetails },
} = Renderer;

function listOrAny(values: string[]): string {
  return values.length === 0 ? "any" : values.join(", ");
}

function SyncWindows({ project }: { project: AppProject }) {
  const windows = describeWindows(project);

  if (windows.length === 0) return <DrawerItem name="Sync windows">none</DrawerItem>;

  return (
    <>
      <DrawerTitle>Sync windows ({windows.length})</DrawerTitle>
      <Table scrollable={false}>
        <TableHead sticky={false}>
          <TableCell>Kind</TableCell>
          <TableCell>Schedule</TableCell>
          <TableCell>Duration</TableCell>
          <TableCell>Applies to</TableCell>
          <TableCell>Manual sync</TableCell>
          <TableCell>Description</TableCell>
        </TableHead>
        {windows.map((window) => (
          <TableRow key={window.key} nowrap>
            <TableCell>{window.kind}</TableCell>
            <TableCell>
              <code>{window.schedule}</code>
            </TableCell>
            <TableCell>{window.duration}</TableCell>
            <TableCell>{window.appliesTo}</TableCell>
            <TableCell>{window.manualSync}</TableCell>
            <TableCell>
              {window.fromFreelens ? <b>{window.description}</b> : window.description || "—"}
            </TableCell>
          </TableRow>
        ))}
      </Table>
    </>
  );
}

function Roles({ project }: { project: AppProject }) {
  const roles = describeRoles(project);

  if (roles.length === 0) return <DrawerItem name="Roles">none</DrawerItem>;

  return (
    <>
      <DrawerTitle>Roles ({roles.length})</DrawerTitle>
      <Table scrollable={false}>
        <TableHead sticky={false}>
          <TableCell>Name</TableCell>
          <TableCell>Description</TableCell>
          <TableCell>Groups</TableCell>
          <TableCell>Policies</TableCell>
        </TableHead>
        {roles.map((role) => (
          <TableRow key={role.name} nowrap>
            <TableCell>{role.name}</TableCell>
            <TableCell>{role.description || "—"}</TableCell>
            <TableCell>{role.groups.join(", ") || "—"}</TableCell>
            <TableCell>{role.policies}</TableCell>
          </TableRow>
        ))}
      </Table>
    </>
  );
}

export interface AppProjectDetailsProps
  extends Renderer.Component.KubeObjectDetailsProps<AppProject> {
  extension: Renderer.LensExtension;
}

export const AppProjectDetails = observer(({ object, extension }: AppProjectDetailsProps) => {
  const store = useKubeStore(() => Application.getStore<Application>());

  const { gaveUp, loadedFor, failures } = useLoadedStores([{ kind: "Application", store }]);

  if (!object) return null;

  const applications = (store?.items ?? []) as Application[];
  const governed = AppProject.selectApplications(object, applications);
  const state = loadState({
    registered: Boolean(store),
    loaded: loadedForScope([store], loadedFor, ""),
    refused: refusedEverywhere(failures, "Application", []),
    itemCount: applications.length,
    gaveUp,
  });
  const count = knownCount(state, governed.length);
  const description = AppProject.getDescription(object);

  return (
    <div className="ArgoCD ArgoCDAppProjectDetails">
      <ArgoCDStyles />
      <StateBanner state={projectState(object, count)} />
      {description && <DrawerItem name="Description">{description}</DrawerItem>}
      <DrawerItem name="Source repos">{listOrAny(AppProject.getSourceRepos(object))}</DrawerItem>
      <DrawerItem name="Destinations">{listOrAny(AppProject.getDestinations(object))}</DrawerItem>
      {AppProject.getSourceNamespaces(object).length > 0 && (
        <DrawerItem name="Source namespaces">
          {AppProject.getSourceNamespaces(object).join(", ")}
        </DrawerItem>
      )}
      {kindRules(object).map(({ label, kinds }) => (
        <DrawerItem key={label} name={label}>
          {kinds.join(", ")}
        </DrawerItem>
      ))}

      <SyncWindows project={object} />
      <Roles project={object} />

      <DrawerTitle>Applications{count === undefined ? "" : ` (${count})`}</DrawerTitle>
      {count === undefined || count === 0 ? (
        <DrawerItem name="">{emptyText(state, describeLoadState, "none")}</DrawerItem>
      ) : (
        <>
          <Table selectable scrollable={false}>
            <TableHead sticky={false}>
              <TableCell>Name</TableCell>
              <TableCell>Namespace</TableCell>
              <TableCell>Sync</TableCell>
              <TableCell>Health</TableCell>
            </TableHead>
            {governed.map((application) => (
              <TableRow
                key={`${application.getNs()}/${application.getName()}`}
                nowrap
                onClick={() => showDetails(application.selfLink)}
              >
                <TableCell>{application.getName()}</TableCell>
                <TableCell>{application.getNs()}</TableCell>
                <TableCell>
                  <SyncBadge status={Application.getSyncStatus(application)} />
                </TableCell>
                <TableCell>
                  <HealthBadge
                    status={Application.getHealthStatus(application)}
                    message={Application.getHealthMessage(application)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </Table>
          <DrawerItem name="">
            <DrawerLink
              label="Open them in the Applications list"
              title="Opens the Applications list narrowed to this project"
              onOpen={() => openProjectApplications(extension, object)}
            />
          </DrawerItem>
        </>
      )}
    </div>
  );
});
