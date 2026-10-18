export type HostKind = "Pod" | "Node" | "Service";

const LISTS: Record<HostKind, string> = { Pod: "/pods", Node: "/nodes", Service: "/services" };

export const HOST_LIST_TITLES: Record<HostKind, string> = {
  Pod: "Pods",
  Node: "Nodes",
  Service: "Services",
};

// A page of ours cannot open the host's drawer; host lists read ?search=.
export function hostListOf(kind: HostKind, name: string): string {
  return `${LISTS[kind]}?search=${encodeURIComponent(name)}`;
}
