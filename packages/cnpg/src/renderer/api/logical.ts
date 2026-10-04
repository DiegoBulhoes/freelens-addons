import type { Verdict } from "./clusters";
import type { PublicationLike, SubscriptionLike } from "./types";

export interface LogicalRow {
  kind: "Publication" | "Subscription";
  object: PublicationLike | SubscriptionLike;
  cluster: string;
  database: string;
  name: string;
  /** What it publishes, or where it subscribes from. */
  peer: string;
  verdict: Verdict;
}

export function logicalVerdict(object: PublicationLike | SubscriptionLike): Verdict {
  const applied = object.status?.applied;

  if (applied === true) return { tone: "ok", label: "Applied", reason: "Applied in Postgres." };
  if (applied === false) {
    return {
      tone: "critical",
      label: "Not applied",
      reason: object.status?.message ?? "The operator could not apply it.",
    };
  }

  return { tone: "info", label: "Pending", reason: "The operator has not reported on it yet." };
}

export function logicalRows(
  publications: PublicationLike[],
  subscriptions: SubscriptionLike[],
): LogicalRow[] {
  return [
    ...publications.map(
      (publication): LogicalRow => ({
        kind: "Publication",
        object: publication,
        cluster: publication.spec.cluster.name,
        database: publication.spec.dbname,
        name: publication.spec.name,
        peer: publication.spec.target?.allTables ? "all tables" : "some tables",
        verdict: logicalVerdict(publication),
      }),
    ),
    ...subscriptions.map(
      (subscription): LogicalRow => ({
        kind: "Subscription",
        object: subscription,
        cluster: subscription.spec.cluster.name,
        database: subscription.spec.dbname,
        name: subscription.spec.name,
        peer: `${subscription.spec.publicationName} on ${subscription.spec.externalClusterName}`,
        verdict: logicalVerdict(subscription),
      }),
    ),
  ];
}

// Both default to retain: deleting the object leaves the publication or subscription in Postgres.
export function dropsInPostgres(row: LogicalRow): boolean {
  const policy =
    row.kind === "Publication"
      ? (row.object as PublicationLike).spec.publicationReclaimPolicy
      : (row.object as SubscriptionLike).spec.subscriptionReclaimPolicy;

  return policy === "delete";
}
