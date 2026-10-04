import { Renderer } from "@freelensapp/extensions";

import { budgetsOf, maintenanceOf, managedRoles, tablespaces } from "../api/cluster-status";
import { formatBytes, slotRows } from "../api/replication";
import type { ClusterLike, InstanceStatus, PodDisruptionBudgetLike } from "../api/types";
import { Status } from "../components/status";
import { confirmMaintenance } from "./dialogs";

const {
  Component: { WithTooltip },
} = Renderer;

export function ReplicationSection({ primary }: { primary?: InstanceStatus }) {
  const slots = slotRows(primary);

  return (
    <section className="CNPG-section" data-section="cnpg-replication">
      <h3 className="CNPG-section__title">Replication slots</h3>
      {!primary ? (
        <p className="CNPG-section__note">The primary's status could not be read.</p>
      ) : slots.length === 0 ? (
        <p className="CNPG-section__note">No slot on the primary.</p>
      ) : (
        <dl className="CNPG-facts">
          {slots.map((row) => (
            <div key={row.slot.slotName} style={{ display: "contents" }}>
              <dt>{row.slot.slotName}</dt>
              <dd>
                <Status tone={row.tone} label={row.slot.active ? "Active" : "Inactive"} />
                <span className="CNPG-muted">
                  {" "}
                  · {row.slot.slotType}
                  {row.slot.database && ` on ${row.slot.database}`} · keeps{" "}
                  {formatBytes(row.retainedBytes ?? 0)} · WAL {row.slot.walStatus ?? "unknown"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {primary && (
        <p className="CNPG-hint">
          WAL archiving {primary.isArchivingWAL ? "on" : "off"}
          {primary.lastFailedWALTime && primary.lastFailedWALTime !== "-infinity"
            ? `; last failure ${primary.lastFailedWAL} at ${primary.lastFailedWALTime}`
            : ""}
          .
        </p>
      )}
    </section>
  );
}

export function DeclaredSections({
  cluster,
  budgets,
}: {
  cluster: ClusterLike;
  budgets: PodDisruptionBudgetLike[];
}) {
  const roles = managedRoles(cluster);
  const spaces = tablespaces(cluster);
  const pdbs = budgetsOf(cluster, budgets);
  const maintenance = maintenanceOf(cluster);

  return (
    <>
      <section className="CNPG-section" data-section="cnpg-roles">
        <h3 className="CNPG-section__title">Managed roles</h3>
        {roles.length === 0 ? (
          <p className="CNPG-section__note">No role reported.</p>
        ) : (
          <dl className="CNPG-facts">
            {roles.map((role) => (
              <div key={role.name} style={{ display: "contents" }}>
                <dt>{role.name}</dt>
                <dd>
                  <Status tone={role.tone} label={role.state} />
                  {role.error && <span className="CNPG-text--critical"> · {role.error}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {spaces.length > 0 && (
        <section className="CNPG-section" data-section="cnpg-tablespaces">
          <h3 className="CNPG-section__title">Tablespaces</h3>
          <dl className="CNPG-facts">
            {spaces.map((space) => (
              <div key={space.name} style={{ display: "contents" }}>
                <dt>{space.name}</dt>
                <dd>
                  <Status tone={space.tone} label={space.state} />
                  {space.owner && <span className="CNPG-muted"> · owned by {space.owner}</span>}
                  {space.error && <span className="CNPG-text--critical"> · {space.error}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="CNPG-section" data-section="cnpg-budgets">
        <h3 className="CNPG-section__title">Disruption budgets</h3>
        {pdbs.length === 0 ? (
          <p className="CNPG-section__note">No PodDisruptionBudget for this cluster.</p>
        ) : (
          <dl className="CNPG-facts">
            {pdbs.map((pdb) => (
              <div key={pdb.name} style={{ display: "contents" }}>
                <dt>{pdb.name}</dt>
                <dd>
                  <Status tone={pdb.tone} label={`${pdb.healthy} of ${pdb.expected} healthy`} />
                  <span className="CNPG-muted">
                    {" "}
                    · {pdb.desired} wanted · {pdb.allowed} disruption{pdb.allowed === 1 ? "" : "s"}{" "}
                    allowed
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="CNPG-section" data-section="cnpg-maintenance">
        <div className="CNPG-section__bar">
          <h3 className="CNPG-section__title">Node maintenance</h3>
          <WithTooltip
            tooltip={
              maintenance.inProgress
                ? "Ends the window; node drains count as failures again. Asks first"
                : "Opens a window so a node with an instance can be drained. Asks first"
            }
          >
            <button
              type="button"
              className="CNPG-button"
              onClick={() => confirmMaintenance(cluster)}
            >
              {maintenance.inProgress ? "End window" : "Start window"}
            </button>
          </WithTooltip>
        </div>
        <p className="CNPG-section__note">
          {maintenance.inProgress ? "A window is open" : "No window is open"};{" "}
          {maintenance.reusePVC
            ? "a drained node's volume is waited for and reused."
            : "a drained node's instance is rebuilt elsewhere."}
        </p>
      </section>
    </>
  );
}
