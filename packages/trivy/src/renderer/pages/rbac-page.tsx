import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import { checkLink } from "../api/check-link";
import {
  type CheckGroup,
  checkSearchTexts,
  checkSortValue,
  describeRbac,
  getRoleFindings,
  groupByCheck,
  hostListOf,
  roleCounts,
} from "../api/rbac";
import { toneOf } from "../api/severity";
import { subjectKey } from "../api/subjects";
import { type Column, ListPage } from "../components/list-page";
import { NamespaceFilter } from "../components/namespace-filter";
import { ObjectDrawer } from "../components/object-drawer";
import { TrivyStyles } from "../components/styles";
import { useRbacStores } from "../hooks/use-rbac-stores";

const {
  Navigation: { navigate },
} = Renderer;

function SeverityMark({ severity }: { severity: CheckGroup["severity"] }) {
  return (
    <span className={`Trivy-tag Trivy-severity--${severity ?? "UNKNOWN"}`}>
      {severity ?? "UNKNOWN"}
    </span>
  );
}

const COLUMNS: Column<CheckGroup>[] = [
  {
    title: "Severity",
    className: "Trivy-table__shrink",
    cell: (group) => <SeverityMark severity={group.severity} />,
    sortValue: (group) => checkSortValue(group, "Severity"),
  },
  {
    title: "Check",
    className: "Trivy-table__fill",
    cell: (group) => <span title={group.title}>{group.title}</span>,
    sortValue: (group) => checkSortValue(group, "Check"),
  },
  {
    title: "ID",
    className: "Trivy-table__shrink",
    cell: (group) => group.checkID,
    sortValue: (group) => checkSortValue(group, "ID"),
  },
  {
    title: "Roles",
    className: "Trivy-table__number",
    cell: (group) => roleCounts(group).roles,
    sortValue: (group) => checkSortValue(group, "Roles"),
  },
  {
    title: "ClusterRoles",
    className: "Trivy-table__number",
    cell: (group) => roleCounts(group).clusterRoles,
    sortValue: (group) => checkSortValue(group, "ClusterRoles"),
  },
];

export const RbacPage = observer(() => {
  const { reports, isReady, gaveUp } = useRbacStores();
  const [openCheck, setOpenCheck] = useState<string | undefined>();

  if (!isReady) {
    return (
      <div className="Trivy Trivy-page">
        <TrivyStyles />
        <div className="Trivy-page__head">
          <div>
            <h1 className="Trivy-page__headline">RBAC checks</h1>
            <p className="Trivy-page__subline">
              Waiting for the Trivy operator's RBAC assessment CRDs. If the operator is not
              installed here, there is nothing to show.
            </p>
          </div>
          <div className="Trivy-page__actions">
            <NamespaceFilter />
          </div>
        </div>
      </div>
    );
  }

  const findings = getRoleFindings(reports);
  const groups = groupByCheck(findings);
  const opened = groups.find((group) => group.checkID === openCheck);

  return (
    <ListPage
      title="RBAC checks"
      subline={
        gaveUp ? (
          <span className="Trivy-text--critical">
            The RBAC assessments could not be read. Check the connection to the cluster and the
            permission to list them.
          </span>
        ) : (
          describeRbac(findings)
        )
      }
      rows={groups}
      columns={COLUMNS}
      keyOf={(group) => group.checkID}
      searchTexts={checkSearchTexts}
      onOpen={(group) => setOpenCheck(group.checkID)}
      empty="No Role in the selected namespaces, and no ClusterRole, fails a check the scanner runs."
    >
      <CheckDrawer group={opened} onClose={() => setOpenCheck(undefined)} />
    </ListPage>
  );
});

function CheckDrawer({ group, onClose }: { group?: CheckGroup; onClose: () => void }) {
  const link = checkLink(group?.checkID);
  const counts = group ? roleCounts(group) : { roles: 0, clusterRoles: 0 };

  return (
    <ObjectDrawer
      open={Boolean(group)}
      kind="Check"
      name={group?.title ?? ""}
      onClose={onClose}
      state={
        group && {
          tone: toneOf(group.severity),
          label: `${group.severity ?? "UNKNOWN"}: ${group.findings.length} ${group.findings.length === 1 ? "role fails" : "roles fail"} this check`,
          reason: group.remediation ?? "The check gives no remediation.",
        }
      }
    >
      {group && (
        <>
          <dl className="Trivy-facts">
            <dt>Check</dt>
            <dd>
              {link ? (
                <a
                  className="Trivy-link"
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  title="What this check looks for, and how to fix it"
                >
                  {group.checkID}
                </a>
              ) : (
                group.checkID
              )}
            </dd>
            <dt>Severity</dt>
            <dd>
              <SeverityMark severity={group.severity} />
            </dd>
            <dt>Roles</dt>
            <dd>{counts.roles}</dd>
            <dt>ClusterRoles</dt>
            <dd>{counts.clusterRoles}</dd>
          </dl>

          <section className="Trivy-section" data-section="check-roles">
            <h3 className="Trivy-section__title">Roles that fail it</h3>
            <table className="Trivy-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Kind</th>
                  <th>Namespace</th>
                  <th>What it grants</th>
                </tr>
              </thead>
              <tbody>
                {group.findings.map((finding) => (
                  <tr key={`${subjectKey(finding.subject)}/${finding.check.checkID}`}>
                    <td className="Trivy-table__shrink">
                      <button
                        type="button"
                        className="Trivy-link"
                        title={`Opens the ${finding.clusterScoped ? "ClusterRoles" : "Roles"} list, narrowed to this one`}
                        onClick={() => {
                          // Close the drawer before the page under it changes.
                          onClose();
                          navigate(hostListOf(finding));
                        }}
                      >
                        {finding.subject.name}
                      </button>
                    </td>
                    <td className="Trivy-table__shrink">{finding.subject.kind}</td>
                    <td className="Trivy-table__shrink">
                      {finding.clusterScoped ? (
                        <span className="Trivy-muted">every namespace</span>
                      ) : (
                        finding.subject.namespace
                      )}
                    </td>
                    <td className="Trivy-table__fill" title={finding.check.messages?.[0]}>
                      {finding.check.messages?.[0] ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </ObjectDrawer>
  );
}
