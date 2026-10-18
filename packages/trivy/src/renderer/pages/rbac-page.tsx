import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import {
  type CheckGroup,
  checkSearchTexts,
  checkSortValue,
  describeRbac,
  getRoleFindings,
  groupByCheck,
  roleCounts,
  roleListOf,
} from "../api/rbac/rbac";
import { toneOf } from "../api/shared/severity";
import { subjectKey } from "../api/shared/subjects";
import { CheckLink } from "../components/check-link";
import { type Column, ListPage } from "../components/list-page";
import { LoadGaps } from "../components/load-gaps";
import { ObjectDrawer } from "../components/object-drawer";
import { SeverityTag } from "../components/severity-tag";
import { useRbacStores } from "../hooks/use-rbac-stores";
import { PageGate } from "./page-head";

const {
  Navigation: { navigate },
} = Renderer;

const COLUMNS: Column<CheckGroup>[] = [
  {
    title: "Severity",
    className: "Trivy-table__shrink",
    cell: (group) => <SeverityTag severity={group.severity} />,
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
  const { reports, registered, state, gaps } = useRbacStores();
  const [openCheck, setOpenCheck] = useState<string | undefined>();

  // Before the list lands, an empty table would read as "no role fails a check".
  if (!registered || state !== "ready") {
    return (
      <PageGate
        title="RBAC checks"
        registered={registered}
        state={state}
        waiting="Waiting for the Trivy operator's RBAC assessment CRDs. If the operator is not installed here, there is nothing to show."
        unreachable="The RBAC assessments could not be read. Check the connection to the cluster and the permission to list them."
      />
    );
  }

  const findings = getRoleFindings(reports);
  const groups = groupByCheck(findings);
  const opened = groups.find((group) => group.checkID === openCheck);

  return (
    <ListPage
      title="RBAC checks"
      subline={describeRbac(findings)}
      filters={<LoadGaps gaps={gaps} />}
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
              <CheckLink className="Trivy-link" checkID={group.checkID} fallback={group.checkID} />
            </dd>
            <dt>Severity</dt>
            <dd>
              <SeverityTag severity={group.severity} />
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
                          navigate(roleListOf(finding));
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
