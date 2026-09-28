import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { getOverview, unjudgedWorkloads } from "../api/overview";
import { getScanProgress } from "../api/scan-progress";
import { countOf } from "../api/severity";
import { getWorkloadRows, mostExposed } from "../api/workload-rows";
import { TrivyStyles } from "../components/styles";
import { useTrivyStores } from "../hooks/use-trivy-stores";
import { CoverageSection } from "../overview/coverage-section";
import { ExposureSection } from "../overview/exposure-section";
import { ScanProgressBanner } from "../overview/scan-progress-banner";
import { StatCard } from "../overview/stat-card";

/** Enough to show where the work is; the whole list is one click away. */
const MOST_EXPOSED = 5;

const {
  Component: { Spinner },
} = Renderer;

export const DashboardPage = observer(
  ({ extension }: { extension: RendererTypes.LensExtension }) => {
    const stores = useTrivyStores();

    if (!stores.isReady) {
      return (
        <div className="Trivy Trivy-page">
          <TrivyStyles />
          <div className="Trivy-page__head">
            <div>
              <h1 className="Trivy-page__headline">Trivy</h1>
              <p className="Trivy-page__subline">
                Waiting for the Trivy operator's report CRDs. If the operator is not installed in
                this cluster, there is nothing here to show.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (!stores.hasLoaded) {
      return (
        <div className="Trivy Trivy-page">
          <TrivyStyles />
          <Spinner center />
        </div>
      );
    }

    const overview = getOverview(stores);
    const unjudged = unjudgedWorkloads(overview.coverage);
    const rows = getWorkloadRows(stores);
    const progress = getScanProgress(rows, Date.now());
    const criticals = countOf(overview.vulnerabilitySummary, "CRITICAL");
    const auditCriticals = countOf(overview.configAuditSummary, "CRITICAL");
    const auditHighs = countOf(overview.configAuditSummary, "HIGH");

    return (
      <div className="Trivy Trivy-page">
        <TrivyStyles />
        <div className="Trivy-page__head">
          <div>
            <h1 className="Trivy-page__headline">
              {criticals} critical {criticals === 1 ? "finding" : "findings"} in{" "}
              {overview.counts.scanned} scanned{" "}
              {overview.counts.scanned === 1 ? "workload" : "workloads"}
            </h1>
            <p
              className={`Trivy-page__subline${
                unjudged.length > 0 ? " Trivy-page__subline--alarm" : ""
              }`}
            >
              {/* Never a bare count: a number of findings is a number of things looked at. */}
              {unjudged.length > 0
                ? "These counts are a minimum: the workloads listed below have no verdict yet."
                : "Every workload the operator knows about has a verdict."}
            </p>
          </div>
        </div>

        <ScanProgressBanner progress={progress} />

        <div className="Trivy-cards">
          <StatCard
            value={overview.criticalFixable}
            label="Critical, fix published"
            tone="critical"
          />
          <StatCard
            value={overview.criticalUnfixable}
            label="Critical, no fix yet"
            tone="critical"
          />
          <StatCard value={overview.highFixable} label="High, fix published" tone="warning" />
          <StatCard value={overview.counts.total} label="Workloads known" />
          <StatCard value={auditCriticals + auditHighs} label="Config issues, critical or high" />
          <StatCard value={overview.exposedSecrets} label="Exposed secrets" />
        </div>

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
