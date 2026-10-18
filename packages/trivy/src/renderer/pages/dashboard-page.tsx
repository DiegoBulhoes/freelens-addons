import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { describeOverview, getOverview, unjudgedWorkloads } from "../api/overview/overview";
import { getScanProgress, judgedOf } from "../api/overview/scan-progress";
import type { WorkloadFilter } from "../api/workloads/workload-filter";
import { getWorkloadRows, mostExposed } from "../api/workloads/workload-rows";
import { LoadGaps } from "../components/load-gaps";
import { StatCard } from "../components/stat-card";
import { TrivyStyles } from "../components/styles";
import { useJudgedHistory } from "../hooks/use-judged-history";
import { useTrivyStores } from "../hooks/use-trivy-stores";
import { CoverageSection } from "../overview/coverage-section";
import { ExposureSection } from "../overview/exposure-section";
import { ScanProgressBanner } from "../overview/scan-progress-banner";
import { PageGate, PageHead } from "./page-head";
import { paramsOf } from "./workloads-route";

const MOST_EXPOSED = 5;

export const DashboardPage = observer(
  ({ extension }: { extension: RendererTypes.LensExtension }) => {
    const stores = useTrivyStores();
    const ready = stores.registered && stores.state === "ready";
    const rows = ready ? getWorkloadRows(stores) : [];
    const history = useJudgedHistory(ready ? judgedOf(rows) : undefined, stores.scopeKey);

    if (!ready) {
      return (
        <PageGate
          title="Trivy"
          registered={stores.registered}
          state={stores.state}
          waiting="Waiting for the Trivy operator's report CRDs. If the operator is not installed in this cluster, there is nothing here to show."
          unreachable="The Trivy operator's reports could not be read. Check the connection to the cluster and the permission to list them."
        />
      );
    }

    const overview = getOverview(stores);
    const head = describeOverview(overview);
    const unjudged = unjudgedWorkloads(overview.coverage);
    const progress = getScanProgress(rows, Date.now(), history);

    const openWorkloads = (filter: WorkloadFilter) =>
      void extension.navigate("workloads", { filter });

    return (
      <div className="Trivy Trivy-page">
        <TrivyStyles />
        <PageHead headline={head.headline} subline={head.subline} alarm={head.alarm} />

        <LoadGaps gaps={stores.gaps} />

        {overview.counts.total > 0 && (
          <>
            <ScanProgressBanner progress={progress} />

            <div className="Trivy-cards">
              <StatCard
                value={overview.criticalFixable}
                label="Critical, fix published"
                tone="critical"
                title="Opens Workloads with only those that have a critical finding with a published fix"
                onOpen={() => openWorkloads("criticalFixable")}
              />
              <StatCard
                value={overview.criticalUnfixable}
                label="Critical, no fix yet"
                tone="critical"
                title="Opens Workloads with only those that have a critical finding with no published fix"
                onOpen={() => openWorkloads("criticalUnfixable")}
              />
              <StatCard
                value={overview.highFixable}
                label="High, fix published"
                tone="warning"
                title="Opens Workloads with only those that have a high finding with a published fix"
                onOpen={() => openWorkloads("highFixable")}
              />
              <StatCard
                value={overview.counts.total}
                label="Workloads known"
                title="Opens Workloads with every workload listed"
                onOpen={() => openWorkloads("all")}
              />
              <StatCard
                value={overview.configIssues}
                label="Config issues, critical or high"
                title="Opens Workloads with only those that fail a critical or high config check"
                onOpen={() => openWorkloads("configIssues")}
              />
              <StatCard
                value={overview.exposedSecrets}
                label="Exposed secrets, critical or high"
                title="Opens Workloads with only those that expose a critical or high secret"
                onOpen={() => openWorkloads("exposedSecrets")}
              />
            </div>
          </>
        )}

        <CoverageSection
          counts={overview.counts}
          unjudged={unjudged}
          onOpenWorkload={(entry) => void extension.navigate("workloads", paramsOf(entry.subject))}
          onOpenAll={() => openWorkloads("unjudged")}
        />

        <ExposureSection
          rows={mostExposed(rows, MOST_EXPOSED)}
          total={rows.length}
          onOpenWorkload={(subject) => void extension.navigate("workloads", paramsOf(subject))}
          onOpenAll={() => void extension.navigate("workloads")}
        />
      </div>
    );
  },
);
