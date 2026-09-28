import type { Counts } from "../api/overview";
import { StatCard } from "./stat-card";

export function PlatformCards({
  counts,
  onOpenApplications,
  onOpenProjects,
}: {
  counts: Counts;
  onOpenApplications: (status?: string) => void;
  onOpenProjects: () => void;
}) {
  return (
    <section className="ArgoCD-section">
      <div className="ArgoCD-cards">
        <StatCard
          label="Applications"
          value={counts.applications}
          onOpen={() => onOpenApplications()}
        />
        <StatCard label="Projects" value={counts.projects} onOpen={() => onOpenProjects()} />
        <StatCard
          label="Synced"
          value={counts.sync.Synced}
          onOpen={() => onOpenApplications("synced")}
        />
        <StatCard
          label="OutOfSync"
          value={counts.sync.OutOfSync}
          tone="warning"
          onOpen={() => onOpenApplications("outofsync")}
        />
        <StatCard
          label="Healthy"
          value={counts.health.Healthy}
          onOpen={() => onOpenApplications("healthy")}
        />
        <StatCard
          label="Degraded"
          value={counts.health.Degraded + counts.health.Missing}
          tone="critical"
          onOpen={() => onOpenApplications("degraded")}
        />
        <StatCard
          label="Progressing"
          value={counts.health.Progressing}
          tone="info"
          onOpen={() => onOpenApplications("progressing")}
        />
        <StatCard
          label="No auto-sync"
          value={counts.manualOnly}
          tone="info"
          onOpen={() => onOpenApplications("manual")}
        />
      </div>

      {counts.manualOnly > 0 && (
        <p className="ArgoCD-section__note">
          {counts.manualOnly} Application{counts.manualOnly === 1 ? "" : "s"} will not self-heal:
          drift on {counts.manualOnly === 1 ? "it" : "them"} stays until someone syncs by hand.
        </p>
      )}
    </section>
  );
}
