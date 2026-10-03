import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type { ReactNode } from "react";

import { describeOverview, getOverview, unjudgedWorkloads } from "../api/overview";
import { getScanProgress } from "../api/scan-progress";
import { countOf } from "../api/severity";
import type { WorkloadFilter } from "../api/workload-filter";
import { getWorkloadRows, mostExposed } from "../api/workload-rows";
import { NamespaceFilter } from "../components/namespace-filter";
import { StatCard } from "../components/stat-card";
import { TrivyStyles } from "../components/styles";
import { useTrivyStores } from "../hooks/use-trivy-stores";
import { CoverageSection } from "../overview/coverage-section";
import { ExposureSection } from "../overview/exposure-section";
import { ScanProgressBanner } from "../overview/scan-progress-banner";

const MOST_EXPOSED = 5;

const {
  Component: { Spinner },
} = Renderer;

function Head({
  headline,
  subline,
  alarm = false,
}: {
  headline: ReactNode;
  subline: ReactNode;
  alarm?: boolean;
}) {
  return (
    <div className="Trivy-page__head">
      <div>
        <h1 className="Trivy-page__headline">{headline}</h1>
        <p className={`Trivy-page__subline${alarm ? " Trivy-page__subline--alarm" : ""}`}>
          {subline}
        </p>
      </div>
      <div className="Trivy-page__actions">
        <NamespaceFilter />
      </div>
    </div>
  );
}

export const DashboardPage = observer(
  ({ extension }: { extension: RendererTypes.LensExtension }) => {
    const stores = useTrivyStores();

    if (!stores.isReady) {
      return (
        <div className="Trivy Trivy-page">
          <TrivyStyles />
          <Head
            headline="Trivy"
            subline="Waiting for the Trivy operator's report CRDs. If the operator is not installed in this cluster, there is nothing here to show."
          />
        </div>
      );
    }

    if (!stores.hasLoaded) {
      return (
        <div className="Trivy Trivy-page">
          <TrivyStyles />
          {stores.gaveUp ? (
            <Head
              headline="Trivy"
              subline="The Trivy operator's reports could not be read. Check the connection to the cluster and the permission to list them."
              alarm
            />
          ) : (
            <Spinner center />
          )}
        </div>
      );
    }

    const overview = getOverview(stores);
    const head = describeOverview(overview);
    const unjudged = unjudgedWorkloads(overview.coverage);
    const rows = getWorkloadRows(stores);
    const progress = getScanProgress(rows, Date.now());
    const auditCriticals = countOf(overview.configAuditSummary, "CRITICAL");
    const auditHighs = countOf(overview.configAuditSummary, "HIGH");

    const openWorkloads = (filter: WorkloadFilter) =>
      void extension.navigate("workloads", { filter });

    return (
      <div className="Trivy Trivy-page">
        <TrivyStyles />
        <Head headline={head.headline} subline={head.subline} alarm={head.alarm} />

        {overview.counts.total > 0 && (
          <>
            <ScanProgressBanner progress={progress} />

            <div className="Trivy-cards">
              <StatCard
                value={overview.criticalFixable}
                label="Critical, fix published"
                tone="critical"
                title="Opens Workloads with only those that have a critical or high finding"
                onOpen={() => openWorkloads("withFindings")}
              />
              <StatCard
                value={overview.criticalUnfixable}
                label="Critical, no fix yet"
                tone="critical"
                title="Opens Workloads with only those that have a critical or high finding"
                onOpen={() => openWorkloads("withFindings")}
              />
              <StatCard
                value={overview.highFixable}
                label="High, fix published"
                tone="warning"
                title="Opens Workloads with only those that have a critical or high finding"
                onOpen={() => openWorkloads("withFindings")}
              />
              <StatCard
                value={overview.counts.total}
                label="Workloads known"
                title="Opens Workloads with every workload listed"
                onOpen={() => openWorkloads("all")}
              />
              <StatCard
                value={auditCriticals + auditHighs}
                label="Config issues, critical or high"
              />
              <StatCard value={overview.exposedSecrets} label="Exposed secrets" />
            </div>
          </>
        )}

        <CoverageSection
          counts={overview.counts}
          unjudged={unjudged}
          onOpenWorkload={(entry) =>
            void extension.navigate("workloads", {
              namespace: entry.subject.namespace,
              kind: entry.subject.kind,
              name: entry.subject.name,
            })
          }
        />

        <ExposureSection
          rows={mostExposed(rows, MOST_EXPOSED)}
          total={rows.length}
          onOpenWorkload={(subject) =>
            void extension.navigate("workloads", {
              namespace: subject.namespace,
              kind: subject.kind,
              name: subject.name,
            })
          }
          onOpenAll={() => void extension.navigate("workloads")}
        />
      </div>
    );
  },
);
