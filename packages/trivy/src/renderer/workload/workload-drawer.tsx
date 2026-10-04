import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import { COVERAGE_STATUS } from "../api/coverage";
import { totalOf } from "../api/severity";
import { subjectKey } from "../api/subjects";
import {
  getWorkloadReport,
  ticketText,
  unfixableOf,
  type WorkloadReport,
  workloadVerdict,
} from "../api/workload-report";
import type { WorkloadRow } from "../api/workload-rows";
import { CheckLink } from "../components/check-link";
import { ObjectDrawer } from "../components/object-drawer";
import { SeverityCounts } from "../components/severity-counts";
import { Status } from "../components/status";
import type { TrivyStores } from "../hooks/use-trivy-stores";
import { useWorkloadPods } from "../hooks/use-workload-pods";
import { ContainerDetails } from "./container-details";
import { FindingTable } from "./finding-table";
import { PackageTable } from "./package-table";
import { PodList } from "./pod-list";

const {
  Component: { Notifications },
} = Renderer;

const SHOWN_CHECKS = 6;

async function copyForTicket(report: WorkloadReport): Promise<void> {
  try {
    await navigator.clipboard.writeText(ticketText(report));
    Notifications.ok(`${report.upgrades.length} upgrades copied.`);
  } catch (error) {
    Notifications.checkedError(error, "Could not copy the upgrade list");
  }
}

export const WorkloadDrawer = observer(
  ({ row, stores, onClose }: { row?: WorkloadRow; stores: TrivyStores; onClose: () => void }) => {
    const report = row
      ? getWorkloadReport(row.subject, {
          vulnerability: stores.vulnerabilityReports,
          configAudit: stores.configAuditReports,
          exposedSecret: stores.exposedSecretReports,
        })
      : undefined;

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind={row?.subject.kind ?? ""}
        name={row?.subject.name ?? ""}
        onClose={onClose}
        state={row && report ? workloadVerdict(row.state, report) : undefined}
        section="trivy-workload"
        actions={
          report && report.upgrades.length > 0
            ? [
                {
                  icon: "content_copy",
                  title: "Copies the upgrades as text for a ticket; changes nothing in the cluster",
                  onClick: () => void copyForTicket(report),
                },
              ]
            : []
        }
      >
        {row && report && (
          // Keyed so the view resets when another row opens in the same drawer.
          <WorkloadBody
            key={subjectKey(report.subject)}
            row={row}
            report={report}
            onClose={onClose}
          />
        )}
      </ObjectDrawer>
    );
  },
);

type View = "packages" | "all" | "unfixable";

const WorkloadBody = observer(
  ({ row, report, onClose }: { row: WorkloadRow; report: WorkloadReport; onClose: () => void }) => {
    const pods = useWorkloadPods(row.subject);
    const [view, setView] = useState<View>("packages");
    const unfixable = unfixableOf(report, "HIGH");
    const coverage = COVERAGE_STATUS[row.state];

    return (
      <>
        <dl className="Trivy-facts">
          <dt>Namespace</dt>
          <dd>{row.subject.namespace}</dd>
          <dt>Coverage</dt>
          <dd>
            <Status tone={coverage.tone} label={coverage.label} />
          </dd>
          <dt>Findings</dt>
          <dd>
            {report.hasVulnerabilityReport ? (
              <SeverityCounts summary={report.summary} />
            ) : (
              <span className="Trivy-muted">unknown: no vulnerability report</span>
            )}
          </dd>
          <dt>Fix published</dt>
          <dd>
            {report.hasVulnerabilityReport
              ? `${row.fixableCount} of ${totalOf(report.summary)}`
              : "—"}
          </dd>
          <dt>Last scan</dt>
          <dd>{report.scannedAt ?? "—"}</dd>
        </dl>

        {report.hasVulnerabilityReport && (
          <section className="Trivy-section" data-section="trivy-workload-findings">
            <div className="Trivy-section__bar">
              <h3 className="Trivy-section__title">
                {view === "packages" ? "Packages to upgrade" : "Findings"}
              </h3>
              <div className="Trivy-filters">
                <button
                  type="button"
                  className="Trivy-filter"
                  aria-pressed={view === "packages"}
                  title="Shows the package upgrades that clear critical and high findings"
                  onClick={() => setView("packages")}
                >
                  By package
                </button>
                <button
                  type="button"
                  className="Trivy-filter"
                  aria-pressed={view === "unfixable"}
                  title="Shows the critical and high findings no upgrade clears yet"
                  onClick={() => setView("unfixable")}
                >
                  No fix ({unfixable.length})
                </button>
                <button
                  type="button"
                  className="Trivy-filter"
                  aria-pressed={view === "all"}
                  title="Shows every finding, worst first"
                  onClick={() => setView("all")}
                >
                  All {totalOf(report.summary)}
                </button>
              </div>
            </div>

            {view === "packages" && <PackageTable upgrades={report.upgrades} />}
            {view === "unfixable" && (
              <FindingTable
                vulnerabilities={unfixable}
                empty="Every critical and high finding here has a published fix."
              />
            )}
            {view === "all" && (
              <FindingTable
                vulnerabilities={report.vulnerabilities}
                empty="The scanner found nothing in this workload's images."
              />
            )}
          </section>
        )}

        <PodList pods={pods} onLeave={onClose} />

        <ContainerDetails containers={report.containers} now={Date.now()} />

        <section className="Trivy-section" data-section="trivy-workload-config">
          <h3 className="Trivy-section__title">Configuration and secrets</h3>
          <dl className="Trivy-facts">
            <dt>Config checks failing</dt>
            <dd>{report.hasConfigAuditReport ? report.failedChecks.length : "no audit report"}</dd>
            <dt>Exposed secrets</dt>
            <dd>{report.exposedSecretCount}</dd>
          </dl>

          {report.failedChecks.length > 0 && (
            <div className="Trivy-list">
              {report.failedChecks.slice(0, SHOWN_CHECKS).map((check) => (
                <div key={check.checkID} className="Trivy-row">
                  <span
                    className={`Trivy-row__state Trivy-severity--${check.severity ?? "UNKNOWN"}`}
                  >
                    {check.severity ?? "UNKNOWN"}
                  </span>
                  <span className="Trivy-row__main">
                    <span>{check.title}</span>
                    {check.messages?.[0] && (
                      <span className="Trivy-row__reason">{check.messages[0]}</span>
                    )}
                  </span>
                  <CheckLink checkID={check.checkID} />
                </div>
              ))}
            </div>
          )}
          {report.failedChecks.length > SHOWN_CHECKS && (
            <p className="Trivy-section__note">
              and {report.failedChecks.length - SHOWN_CHECKS} more failing checks.
            </p>
          )}
        </section>
      </>
    );
  },
);
