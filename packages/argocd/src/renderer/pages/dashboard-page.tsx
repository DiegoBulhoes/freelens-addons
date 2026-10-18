import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useMemo, useState } from "react";
import type { Application } from "../api/applications/application";
import {
  FILTER_LABELS,
  type FilterKey,
  isFilterKey,
  viewAttention,
} from "../api/overview/attention-filter";
import { deriveOverview, overviewMinute } from "../api/overview/dashboard";
import { rememberLast } from "../api/shared/memo";
import { pageOf } from "../api/shared/paging";
import { readPreferences, writePreference } from "../api/shared/preferences";
import { describeHeadline, describeLoadState } from "../api/shared/store-state";
import { plural } from "../api/shared/text";
import { controllerNamespaceOf } from "../api/shared/workload-selection";
import {
  ARGOCD_COMPONENTS,
  type ArgoCDComponent,
  openComponentLogs,
} from "../api/shared/workloads";
import { type BulkOutcome, listNames, refreshEach, syncEach } from "../api/writes/bulk";
import { notifyBulkOutcome } from "../components/bulk";
import { confirmWrite } from "../components/confirm";
import { NamespaceFilter } from "../components/namespace-filter";
import { ArgoCDStyles } from "../components/styles";
import { useArgoCDStores } from "../hooks/use-argocd-stores";
import { useArgoCDUrl } from "../hooks/use-argocd-url";
import { useClusterPressure } from "../hooks/use-cluster-pressure";
import { usePins } from "../hooks/use-pins";
import { AttentionSection } from "../overview/attention-section";
import { ClusterPressureBanner } from "../overview/cluster-pressure-banner";
import { MovingTarget } from "../overview/moving-target";
import { PlatformCards } from "../overview/platform-cards";
import { RecentRollouts } from "../overview/recent-rollouts";
import { SyncingRepeatedly } from "../overview/syncing-repeatedly";
import { APPLICATIONS_PAGE } from "./applications-page";

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
  const { applications, projects, state, gap } = useArgoCDStores();
  const { pinnedIds, reload: reloadPins } = usePins();
  const argoUrl = useArgoCDUrl(applications);
  const pressure = useClusterPressure();

  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [isWorking, setIsWorking] = useState(false);

  const derive = useMemo(() => rememberLast(deriveOverview), []);
  const stateNote = describeLoadState(state);
  const { counts, attention, criticalCount, parents, cohorts, repeated, exposure } = derive(
    applications,
    projects,
    overviewMinute(Date.now()),
  );

  const { ordered, needingAttention } = viewAttention(attention, {
    filter,
    searchText: query,
    pinnedIds,
  });

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
      await navigator.clipboard.writeText(names.join(" "));
      Notifications.ok(`${plural(names.length, "Application name")} copied.`);
    } catch (error) {
      Notifications.checkedError(error, "Could not copy the Application names");
    }
  };

  const openApplications = (status?: string) => {
    void extension.navigate(APPLICATIONS_PAGE, status ? { status } : {});
  };

  // Our pages mount no details drawer; the Applications list does, and opens this one.
  const openApplicationNamed = (application: Application) => {
    void extension.navigate(APPLICATIONS_PAGE, {
      name: application.getName(),
      namespace: application.getNs() ?? "",
    });
  };

  const selectFilter = (next: FilterKey) => {
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

          notifyBulkOutcome(past, result);
        } finally {
          setIsWorking(false);
        }
      },
    });
  };

  return (
    <div className="ArgoCD ArgoCD-page">
      <ArgoCDStyles />

      <div className="ArgoCD-page__head">
        <div>
          <h1 className="ArgoCD-page__headline">
            {describeHeadline(state, needingAttention, applications.length)}

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

          {gap && <p className="ArgoCD-page__subline ArgoCD-page__subline--alarm">{gap}</p>}

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

      {/* Zero counts and "no deploy yet" are claims only a loaded list can make. */}
      {state === "ready" && (
        <PlatformCards
          counts={counts}
          onOpenApplications={openApplications}
          onOpenProjects={() => void extension.navigate("projects")}
        />
      )}

      {attention.length > 0 && (
        <AttentionSection
          attention={attention}
          ordered={ordered}
          currentPage={currentPage}
          parents={parents}
          filter={filter}
          searchText={query}
          pinnedIds={pinnedIds}
          isWorking={isWorking}
          onFilterChange={selectFilter}
          onSearchChange={(text) => {
            setQuery(text);
            setPage(0);
          }}
          onPageChange={setPage}
          onPinsChanged={reloadPins}
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
          onPinsChanged={reloadPins}
          onOpen={openApplicationNamed}
        />
      )}

      {state === "ready" && <RecentRollouts cohorts={cohorts} onOpen={openApplicationNamed} />}

      {exposure.moving.length > 0 && (
        <MovingTarget
          exposure={exposure}
          onCopyNames={(names) => void copyNames(names)}
          onOpen={openApplicationNamed}
        />
      )}
    </div>
  );
});
