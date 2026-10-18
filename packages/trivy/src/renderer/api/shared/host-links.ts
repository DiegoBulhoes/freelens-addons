export const ROLE_LISTS = { Role: "/roles", ClusterRole: "/cluster-roles" } as const;

const LISTS: Partial<Record<string, string>> = {
  Pod: "/pods",
  Deployment: "/deployments",
  ReplicaSet: "/replicasets",
  StatefulSet: "/statefulsets",
  DaemonSet: "/daemonsets",
  Job: "/jobs",
  CronJob: "/cronjobs",
  ...ROLE_LISTS,
};

// A page of ours cannot open the host's drawer; host lists read ?search=.
export function searchListOf(list: string, name: string): string {
  return `${list}?search=${encodeURIComponent(name)}`;
}

export function hostListOf(kind: string, name: string): string | undefined {
  const list = LISTS[kind];

  return list && searchListOf(list, name);
}
