import type { Counts } from "../api/overview/overview";
import { StatCard } from "../components/stat-card";

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
          value={counts.byStatus.synced}
          onOpen={() => onOpenApplications("synced")}
        />
        <StatCard
          label="OutOfSync"
          value={counts.byStatus.outofsync}
          tone="warning"
          onOpen={() => onOpenApplications("outofsync")}
        />
        <StatCard
          label="Healthy"
          value={counts.byStatus.healthy}
          onOpen={() => onOpenApplications("healthy")}
        />
        <StatCard
          label="Degraded"
          value={counts.byStatus.degraded}
          tone="critical"
          onOpen={() => onOpenApplications("degraded")}
        />
        <StatCard
          label="Progressing"
          value={counts.byStatus.progressing}
          tone="info"
          onOpen={() => onOpenApplications("progressing")}
        />
        <StatCard
          label="No auto-sync"
          value={counts.byStatus.manual}
          tone="info"
          onOpen={() => onOpenApplications("manual")}
        />
      </div>

      {counts.byStatus.manual > 0 && (
        <p className="ArgoCD-section__note">
          {counts.byStatus.manual} Application{counts.byStatus.manual === 1 ? "" : "s"} will not
          self-heal: drift on {counts.byStatus.manual === 1 ? "it" : "them"} stays until someone
          syncs by hand.
        </p>
      )}
    </section>
  );
}
