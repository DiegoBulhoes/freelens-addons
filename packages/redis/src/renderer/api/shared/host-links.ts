export type HostKind = "Pod" | "Node" | "PersistentVolumeClaim" | "Secret";

const LISTS: Record<HostKind, string> = {
  Pod: "/pods",
  Node: "/nodes",
  PersistentVolumeClaim: "/persistent-volume-claims",
  Secret: "/secrets",
};

export const HOST_LIST_TITLES: Record<HostKind, string> = {
  Pod: "Opens the host's Pods list, searched by this name",
  Node: "Opens the host's Nodes list, searched by this name",
  PersistentVolumeClaim: "Opens the host's PersistentVolumeClaims list, searched by this name",
  Secret: "Opens the host's Secrets list, searched by this name",
};

// A page of ours cannot open the host's drawer; host lists read ?search=.
export function hostListOf(kind: HostKind, name: string): string {
  return `${LISTS[kind]}?search=${encodeURIComponent(name)}`;
}
