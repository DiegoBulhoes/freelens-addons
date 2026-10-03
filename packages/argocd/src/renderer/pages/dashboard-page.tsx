import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";
import type { Application } from "../api/application";
import {
  FILTER_LABELS,
  type FilterKey,
  isFilterKey,
  pageOf,
  selectAttentionItems,
  sortPinnedFirst,
} from "../api/attention-filter";
import { type BulkOutcome, describeOutcome, listNames, refreshEach, syncEach } from "../api/bulk";
import { copyToClipboard } from "../api/cli";
import { groupDeploysByRevision } from "../api/insights";
import { getAttentionItems, getCounts, getRecentDeploys, getRepeatedSyncs } from "../api/overview";
import { readPreferences, writePreference } from "../api/preferences";
import { getSourceExposure } from "../api/sources";
import { describeHeadline, describeOverviewState } from "../api/store-state";
import {
  ARGOCD_COMPONENTS,
  type ArgoCDComponent,
  controllerNamespaceOf,
  openComponentLogs,
} from "../api/workloads";
import { confirmWrite } from "../components/confirm";
import { NamespaceFilter } from "../components/namespace-filter";
import { ArgoCDStyles } from "../components/styles";
import { useArgoCDStores } from "../hooks/use-argocd-stores";
import { useArgoCDUrl } from "../hooks/use-argocd-url";
import { useClusterPressure } from "../hooks/use-cluster-pressure";
import { useOperatorMarks } from "../hooks/use-operator-marks";
import { AttentionSection } from "../overview/attention-section";
import { ClusterPressureBanner } from "../overview/cluster-pressure-banner";
import { MovingTarget } from "../overview/moving-target";
import { PlatformCards } from "../overview/platform-cards";
import { RecentRollouts } from "../overview/recent-rollouts";
import { SyncingRepeatedly } from "../overview/syncing-repeatedly";

const PAGE_SIZE = 8;

function initialFilter(): FilterKey {
  const stored = readPreferences().attentionFilter;

  return isFilterKey(stored) ? stored : "all";
}

const {
  Component: { Icon, MenuActions, MenuItem, Notifications },
} = Renderer;

export interface DashboardPageProps {
  extension: Renderer.LensExtension;
}

export const DashboardPage = observer(({ extension }: DashboardPageProps) => {
  const { applications, projects, state } = useArgoCDStores();
  const { pinnedIds, reload: reloadMarks } = useOperatorMarks();
  const argoUrl = useArgoCDUrl(applications);
  const pressure = useClusterPressure();

  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [isWorking, setIsWorking] = useState(false);

  const stateNote = describeOverviewState(state);
  const counts = getCounts(applications, projects);
  const attention = getAttentionItems(applications);
  const criticalCount = attention.filter((item) => item.severity === "critical").length;

  const ordered = sortPinnedFirst(
    selectAttentionItems(attention, { filter, searchText: query, pinnedIds }),
    pinnedIds,
  );

  const currentPage = pageOf(ordered, page, PAGE_SIZE);

  const showComponentLogs = async (component: ArgoCDComponent) => {
    const namespace = controllerNamespaceOf(applications);

    const result = await openComponentLogs(component, namespace);

    if (result === "could-not-list") {
      Notifications.error(
        `Could not list pods in ${namespace}, so it is unknown whether ${component} is running.`,
      );
    } else if (result === "no-pods") {
      Notifications.error(`No running pod for ${component} in ${namespace}.`);
    }
  };

  const copyNames = async (names: string[]) => {
    try {
      await copyToClipboard(names.join(" "));
      Notifications.ok(`${names.length} Application name${names.length === 1 ? "" : "s"} copied.`);
    } catch (error) {
      Notifications.checkedError(error, "Could not copy the Application names");
    }
  };

  const openApplications = (status?: string) => {
    void extension.navigate("applications", status ? { status } : {});
  };

  // The details drawer is not mounted on an extension page; the Applications list mounts it.
  const openApplicationNamed = (application: Application) => {
    void extension.navigate("applications", { name: application.getName() });
  };

  const applyFilter = (next: FilterKey) => {
    setFilter(next);
    setPage(0);
    writePreference("attentionFilter", next);
  };

  const runBulkAction = (
    verb: string,
    past: string,
    action: (applications: Application[]) => Promise<BulkOutcome>,
    { destructive }: { destructive: boolean },
  ) => {
    const targets = ordered.map((item) => item.application);

    confirmWrite({
      question: (
        <>
          {verb} all <b>{targets.length}</b> Applications matching{" "}
          <b>{FILTER_LABELS[filter].toLowerCase()}</b>
          {query.trim() && (
            <>
              {" and "}
              <b>{query.trim()}</b>
            </>
          )}
          ?
        </>
      ),
      detail: `${listNames(targets.map((application) => application.getName()))}.${
        destructive
          ? " Nothing is pruned: resources that are no longer in git stay, as with a plain sync."
          : ""
      }`,
      label: `${verb} ${targets.length}`,
      destructive,
      typed: destructive ? () => "confirm" : undefined,
      ok: async () => {
        setIsWorking(true);

        try {
          const result = await action(targets);

          if (result.failures.length === 0) Notifications.ok(describeOutcome(past, result));
          else Notifications.error(describeOutcome(past, result));
        } finally {
          setIsWorking(false);
        }
      },
    });
  };

  const exposure = getSourceExposure(applications);
  const deploys = getRecentDeploys(applications, 40);
  const cohorts = groupDeploysByRevision(deploys);
  const repeated = getRepeatedSyncs(applications);

  return (
    <div className="ArgoCD ArgoCD-page">
      <ArgoCDStyles />

      <div className="ArgoCD-page__head">
        <div>
          <h1 className="ArgoCD-page__headline">
            {describeHeadline(state, ordered.length, applications.length)}

            <MenuActions
              toolbar={false}
              autoCloseOnSelect
              triggerIcon={{ material: "subject", tooltip: "Open an ArgoCD component log" }}
            >
              {ARGOCD_COMPONENTS.map((component) => (
                <MenuItem key={component} onClick={() => void showComponentLogs(component)}>
                  <Icon material="subject" tooltip={`Opens the logs of ${component}`} />
                  <span className="title">{component.replace("argocd-", "")}</span>
                </MenuItem>
              ))}
              {argoUrl && (
                <MenuItem onClick={() => window.open(argoUrl, "_blank", "noopener")}>
                  <Icon material="open_in_new" tooltip="Opens ArgoCD's own web UI in the browser" />
                  <span className="title">Open the ArgoCD UI</span>
                </MenuItem>
              )}
            </MenuActions>
          </h1>

          {stateNote && (
            <p
              className={`ArgoCD-page__subline${
                state === "unreachable" ? " ArgoCD-page__subline--alarm" : ""
              }`}
            >
              {stateNote}
            </p>
          )}

          {criticalCount > 0 && (
            <p className="ArgoCD-page__subline ArgoCD-page__subline--alarm">
              {criticalCount} {criticalCount === 1 ? "is" : "are"} degraded, stuck, failing to sync
              or unable to read git.
            </p>
          )}

          {pinnedIds.size > 0 && (
            <p className="ArgoCD-page__subline">{pinnedIds.size} pinned to the top.</p>
          )}
        </div>
        <div className="ArgoCD-page__actions">
          <NamespaceFilter />
        </div>
      </div>

      <ClusterPressureBanner pressures={pressure} />

      <PlatformCards
        counts={counts}
        onOpenApplications={openApplications}
        onOpenProjects={() => void extension.navigate("projects")}
      />

      {attention.length > 0 && (
        <AttentionSection
          attention={attention}
          ordered={ordered}
          currentPage={currentPage}
          applications={applications}
          filter={filter}
          searchText={query}
          pinnedIds={pinnedIds}
          isWorking={isWorking}
          onFilterChange={applyFilter}
          onSearchChange={(text) => {
            setQuery(text);
            setPage(0);
          }}
          onPageChange={setPage}
          onMarksChanged={reloadMarks}
          onOpen={openApplicationNamed}
          onRefreshAll={() =>
            runBulkAction("Refresh", "Requested a refresh of", refreshEach, { destructive: false })
          }
          onSyncAll={() =>
            runBulkAction("Sync", "Started a sync on", syncEach, { destructive: true })
          }
        />
      )}

      {repeated.length > 0 && (
        <SyncingRepeatedly
          repeated={repeated}
          onMarksChanged={reloadMarks}
          onOpen={openApplicationNamed}
        />
      )}

      <RecentRollouts cohorts={cohorts} />

      {exposure.moving.length > 0 && (
        <MovingTarget exposure={exposure} onCopyNames={(names) => void copyNames(names)} />
      )}
    </div>
  );
});
