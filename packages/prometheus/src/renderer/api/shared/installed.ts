// The kinds the pages read; probes and thanosrulers are left out until a seed covers them.
export const CRD_NAMES: readonly string[] = [
  "servicemonitors.monitoring.coreos.com",
  "podmonitors.monitoring.coreos.com",
  "scrapeconfigs.monitoring.coreos.com",
  "prometheusrules.monitoring.coreos.com",
  "prometheuses.monitoring.coreos.com",
  "prometheusagents.monitoring.coreos.com",
  "alertmanagers.monitoring.coreos.com",
];

export function isInstalled(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (CRD_NAMES.includes(name)) return true;
  }

  return false;
}
