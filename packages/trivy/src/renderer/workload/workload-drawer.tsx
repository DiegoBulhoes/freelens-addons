import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";
import { workloadCommandsFor } from "../api/shared/commands";
import { cutTo } from "../api/shared/cut";
import { hostListOf } from "../api/shared/host-links";
import { subjectKey } from "../api/shared/subjects";
import { describeAge, formatTime } from "../api/shared/time";
import { fixPublished } from "../api/vulnerabilities/findings";
import { COVERAGE_STATUS } from "../api/workloads/coverage";
import {
  describeLowerUpgrades,
  getWorkloadReport,
  ticketText,
  unfixableOf,
  upgradesClearing,
  type WorkloadReport,
  workloadVerdict,
} from "../api/workloads/workload-report";
import type { WorkloadRow } from "../api/workloads/workload-rows";
import { CheckLink } from "../components/check-link";
import { CommandsSection } from "../components/commands-section";
import { DrawerLink } from "../components/drawer-link";
import { ObjectDrawer } from "../components/object-drawer";
import { SeverityCounts } from "../components/severity-counts";
import { ShowAll } from "../components/show-all";
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
    Notifications.ok(`${upgradesClearing(report, "HIGH").length} upgrades copied.`);
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
          report && upgradesClearing(report, "HIGH").length > 0
            ? [
                {
                  icon: "content_copy",
                  title:
                    "Copies the upgrades that clear critical and high findings as text for a ticket; changes nothing in the cluster",
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
    const [allChecks, setAllChecks] = useState(false);
    const checks = cutTo(report.failedChecks, SHOWN_CHECKS, allChecks);
    const unfixable = unfixableOf(report, "HIGH");
    const clearing = upgradesClearing(report, "HIGH");
    const lowerUpgrades = describeLowerUpgrades(report, "HIGH");
    const coverage = COVERAGE_STATUS[row.state];
    const fix = fixPublished(report.vulnerabilities);
    const owner = row.deployment;
    const views: { view: View; label: string; title: string; count: number }[] = [
      {
        view: "packages",
        label: "By package",
        title: "Shows the package upgrades that clear critical and high findings",
        count: clearing.length,
      },
      {
        view: "unfixable",
        label: "No fix",
        title: "Shows the critical and high findings no upgrade clears yet",
        count: unfixable.length,
      },
      {
        view: "all",
        label: "All",
        title: "Shows every finding, worst first",
        count: report.vulnerabilities.length,
      },
    ];

    return (
      <>
        <dl className="Trivy-facts">
          <dt>Namespace</dt>
          <dd>{row.subject.namespace}</dd>
          <dt>{row.subject.kind}</dt>
          <dd>
            <DrawerLink
              title={`Opens the ${row.subject.kind}s list, narrowed to this one`}
              path={hostListOf(row.subject.kind, row.subject.name)}
              onLeave={onClose}
            >
              {row.subject.name}
            </DrawerLink>
          </dd>
          {owner && (
            <>
              <dt>Deployment</dt>
              <dd>
                <DrawerLink
                  title="Opens the Deployments list, narrowed to this ReplicaSet's owner"
                  path={hostListOf("Deployment", owner)}
                  onLeave={onClose}
                >
                  {owner}
                </DrawerLink>
              </dd>
            </>
          )}
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
          <dd>{report.hasVulnerabilityReport ? `${fix.fixable} of ${fix.total}` : "—"}</dd>
          <dt>Last scan</dt>
          <dd title={describeAge(report.scannedAt, Date.now())}>{formatTime(report.scannedAt)}</dd>
        </dl>

        {report.hasVulnerabilityReport && (
          <section className="Trivy-section" data-section="trivy-workload-findings">
            <div className="Trivy-section__bar">
              <h3 className="Trivy-section__title">
                {view === "packages" ? "Packages to upgrade" : "Findings"}
              </h3>
              <div className="Trivy-filters">
                {views.map(({ view: key, label, title, count }) => (
                  <button
                    key={key}
                    type="button"
                    className="Trivy-filter"
                    aria-pressed={view === key}
                    title={title}
                    onClick={() => setView(key)}
                  >
                    {label}
                    <span className="Trivy-filter__count">{count}</span>
                  </button>
                ))}
              </div>
            </div>

            {view === "packages" && (
              <>
                <PackageTable upgrades={clearing} />
                {lowerUpgrades && <p className="Trivy-section__note">{lowerUpgrades}</p>}
              </>
            )}
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

        <PodList pods={pods.pods} state={pods.state} onLeave={onClose} />

        <ContainerDetails containers={report.containers} now={Date.now()} />

        <section className="Trivy-section" data-section="trivy-workload-config">
          <h3 className="Trivy-section__title">Configuration and secrets</h3>
          <dl className="Trivy-facts">
            <dt>Config checks failing</dt>
            <dd>{report.hasConfigAuditReport ? report.failedChecks.length : "no audit report"}</dd>
            <dt>Exposed secrets, all severities</dt>
            <dd>{report.exposedSecrets.length}</dd>
          </dl>

          {checks.shown.length > 0 && (
            <div className="Trivy-list">
              {checks.shown.map((check) => (
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
          <ShowAll
            hidden={checks.hidden}
            total={report.failedChecks.length}
            what="failing checks"
            onShowAll={() => setAllChecks(true)}
          />

          {report.exposedSecrets.length > 0 && (
            <div className="Trivy-list" data-section="trivy-workload-secrets">
              {report.exposedSecrets.map((secret) => (
                <div key={secret.key} className="Trivy-row">
                  <span className={`Trivy-row__state Trivy-severity--${secret.severity}`}>
                    {secret.severity}
                  </span>
                  <span className="Trivy-row__main">
                    <span>{secret.title ?? secret.ruleID ?? "Secret"}</span>
                    {secret.target && (
                      <span className="Trivy-row__reason">
                        <code>{secret.target}</code>
                      </span>
                    )}
                  </span>
                  {secret.ruleID && (
                    <span className="Trivy-row__aside">
                      <code>{secret.ruleID}</code>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <CommandsSection
          commands={workloadCommandsFor(row.subject, row.state)}
          section="trivy-workload-commands"
        />
      </>
    );
  },
);
