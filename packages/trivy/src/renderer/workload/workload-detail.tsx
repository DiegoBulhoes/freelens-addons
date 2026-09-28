import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import { isAtLeast } from "../api/findings";
import { countOf, totalOf } from "../api/severity";
import type { ReportSubject } from "../api/types";
import { getWorkloadReport, summariseAction } from "../api/workload-report";
import { CheckLink } from "../components/check-link";
import { useTrivyStores } from "../hooks/use-trivy-stores";
import { useWorkloadPods } from "../hooks/use-workload-pods";
import { ContainerDetails } from "./container-details";
import { FindingTable } from "./finding-table";
import { PackageTable } from "./package-table";
import { PodList } from "./pod-list";

const {
  Component: { Notifications },
} = Renderer;

type View = "packages" | "all" | "unfixable";

export const WorkloadDetail = observer(({ subject }: { subject: ReportSubject }) => {
  const stores = useTrivyStores();
  const pods = useWorkloadPods(subject);
  const [view, setView] = useState<View>("packages");

  const report = getWorkloadReport(subject, {
    vulnerability: stores.vulnerabilityReports,
    configAudit: stores.configAuditReports,
    exposedSecret: stores.exposedSecretReports,
  });

  const action = summariseAction(report, "HIGH");
  const criticals = countOf(report.summary, "CRITICAL");
  const highs = countOf(report.summary, "HIGH");
  const total = totalOf(report.summary);
  const unfixable = report.vulnerabilities.filter(
    (each) => isAtLeast(each, "HIGH") && !each.fixedVersion,
  );

  const copyForTicket = async () => {
    const lines = report.upgrades.map(
      (upgrade) =>
        `${upgrade.resource} ${upgrade.installedVersion} -> ${upgrade.fixedVersion} (clears ${upgrade.vulnerabilityCount})`,
    );

    try {
      await navigator.clipboard.writeText(
        [
          `${subject.name} (${subject.namespace}) — ${report.image ?? "no image reported"}`,
          ...lines,
        ].join("\n"),
      );
      Notifications.ok(`${report.upgrades.length} upgrades copied.`);
    } catch (error) {
      Notifications.checkedError(error, "Could not copy the upgrade list");
    }
  };

  return (
    <div className="Trivy-page">
      <div className="Trivy-page__head">
        <div>
          <h1 className="Trivy-page__headline">{subject.name}</h1>
          <p className="Trivy-page__subline">
            {subject.namespace} · {subject.kind}
          </p>
        </div>
      </div>

      {!report.hasVulnerabilityReport ? (
        <p className="Trivy-section__note">
          This workload has no vulnerability report, so nobody knows what it contains. No findings
          here does not mean it is clean.
        </p>
      ) : (
        <>
          <div className="Trivy-banner">
            <span className="Trivy-banner__title">
              {action.upgradeCount === 0
                ? "No upgrade published for anything critical or high"
                : `${action.upgradeCount} ${action.upgradeCount === 1 ? "upgrade clears" : "upgrades clear"} ${action.clearedCount} of ${criticals + highs} critical and high findings`}
            </span>
            {action.unfixableCount > 0 && (
              <span className="Trivy-banner__body">
                {action.unfixableCount} have no published fix, so no upgrade will clear them.
              </span>
            )}
          </div>

          <section className="Trivy-section">
            <div className="Trivy-section__bar">
              <h2 className="Trivy-section__title">
                {view === "packages" ? "Packages to upgrade" : "Findings"}
              </h2>
              <div className="Trivy-filters">
                <button
                  type="button"
                  className="Trivy-filter"
                  aria-pressed={view === "packages"}
                  onClick={() => setView("packages")}
                >
                  By package
                </button>
                <button
                  type="button"
                  className="Trivy-filter"
                  aria-pressed={view === "unfixable"}
                  onClick={() => setView("unfixable")}
                >
                  No fix ({unfixable.length})
                </button>
                <button
                  type="button"
                  className="Trivy-filter"
                  aria-pressed={view === "all"}
                  onClick={() => setView("all")}
                >
                  All {total}
                </button>
              </div>
              <button type="button" className="Trivy-button" onClick={() => void copyForTicket()}>
                Copy for a ticket
              </button>
            </div>

            {view === "packages" && <PackageTable upgrades={report.upgrades} />}
            {view === "unfixable" && <FindingTable vulnerabilities={unfixable} />}
            {view === "all" && <FindingTable vulnerabilities={report.vulnerabilities} />}
          </section>
        </>
      )}

      <PodList pods={pods} />

      <ContainerDetails containers={report.containers} now={Date.now()} />

      <section className="Trivy-section">
        <h2 className="Trivy-section__title">Configuration and secrets</h2>
        <div className="Trivy-cards">
          <div className="Trivy-card">
            <span className="Trivy-card__value">{report.failedChecks.length}</span>
            <span className="Trivy-card__label">
              {report.hasConfigAuditReport ? "Config checks failing" : "No config audit report"}
            </span>
          </div>
          <div className="Trivy-card">
            <span className="Trivy-card__value">{report.exposedSecretCount}</span>
            <span className="Trivy-card__label">Exposed secrets</span>
          </div>
        </div>

        {report.failedChecks.length > 0 && (
          <div className="Trivy-list">
            {report.failedChecks.slice(0, 6).map((check) => (
              <div key={check.checkID} className="Trivy-row">
                <span className={`Trivy-row__state Trivy-severity--${check.severity ?? "UNKNOWN"}`}>
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
      </section>
    </div>
  );
});
