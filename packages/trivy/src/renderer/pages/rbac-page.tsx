import { observer } from "mobx-react";
import { useState } from "react";

import { checkLink } from "../api/check-link";
import { getRoleFindings, groupByCheck, rolesAffected, summariseRbac } from "../api/rbac";
import { countOf } from "../api/severity";
import { subjectKey } from "../api/subjects";
import { TrivyStyles } from "../components/styles";
import { useRbacStores } from "../hooks/use-rbac-stores";

const MAX_ROLES_SHOWN = 12;

/**
 * What roles are allowed to do that they probably should not be.
 *
 * Grouped by the check rather than by the role: one misconfiguration usually
 * lands on many roles at once and the remediation is the same sentence for all
 * of them, so the check is the unit of work.
 */
/** The box's edge: critical and high are the two a reader acts on. */
const BOX_TONE: Record<string, string> = {
  CRITICAL: " Trivy-box--critical",
  HIGH: " Trivy-box--warning",
};

export const RbacPage = observer(() => {
  const { reports, isReady } = useRbacStores();
  const [openCheck, setOpenCheck] = useState<string | undefined>();

  if (!isReady) {
    return (
      <div className="Trivy Trivy-page">
        <TrivyStyles />
        <p className="Trivy-section__note">
          Waiting for the Trivy operator's RBAC assessment CRDs. If the operator is not installed
          here, there is nothing to show.
        </p>
      </div>
    );
  }

  const findings = getRoleFindings(reports);
  const groups = groupByCheck(findings);
  const summary = summariseRbac(findings);
  const criticals = countOf(summary, "CRITICAL");

  return (
    <div className="Trivy Trivy-page">
      <TrivyStyles />

      <div className="Trivy-page__head">
        <div>
          <h1 className="Trivy-page__headline">
            {findings.length === 0
              ? "No role grants anything the scanner flags"
              : `${criticals} critical ${criticals === 1 ? "grant" : "grants"} across ${rolesAffected(findings)} roles`}
          </h1>
          <p className="Trivy-page__subline">
            {findings.length} findings in {groups.length}{" "}
            {groups.length === 1 ? "check" : "distinct checks"}. A ClusterRole reaches every
            namespace, so those are listed first.
          </p>
        </div>
      </div>

      <div className="Trivy-list">
        {groups.map((group) => {
          const isOpen = openCheck === group.checkID;
          const shown = isOpen ? group.findings : group.findings.slice(0, MAX_ROLES_SHOWN);
          const link = checkLink(group.checkID);

          return (
            <section
              key={group.checkID}
              className={`Trivy-box${BOX_TONE[group.severity ?? "UNKNOWN"] ?? ""}`}
            >
              <button
                type="button"
                className="Trivy-box__head"
                aria-expanded={isOpen}
                onClick={() => setOpenCheck(isOpen ? undefined : group.checkID)}
              >
                <span className={`Trivy-tag Trivy-severity--${group.severity ?? "UNKNOWN"}`}>
                  {group.severity ?? "UNKNOWN"}
                </span>
                <span className="Trivy-box__title">{group.title}</span>
                <span className="Trivy-box__count">
                  {group.findings.length} {group.findings.length === 1 ? "role" : "roles"}
                </span>
              </button>

              {(group.remediation || link) && (
                <p className="Trivy-box__reason">
                  {group.remediation}{" "}
                  {link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      title="What this check looks for, and how to fix it"
                    >
                      {group.checkID}
                    </a>
                  )}
                </p>
              )}

              <div className="Trivy-chips">
                {shown.map((finding) => (
                  <span
                    key={`${subjectKey(finding.subject)}/${finding.check.checkID}`}
                    className="Trivy-chip"
                    title={finding.check.messages?.[0]}
                  >
                    <code>{finding.subject.name}</code>
                    <span className="Trivy-chip__meta">
                      {finding.clusterScoped ? "cluster" : finding.subject.namespace}
                    </span>
                  </span>
                ))}

                {!isOpen && group.findings.length > shown.length && (
                  <button
                    type="button"
                    className="Trivy-chip"
                    onClick={() => setOpenCheck(group.checkID)}
                  >
                    and {group.findings.length - shown.length} more
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
});
