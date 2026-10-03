import { scopeKey, withinScope } from "../api/namespace-scope";
import {
  ConfigAuditReport,
  ExposedSecretReport,
  SbomReport,
  VulnerabilityReport,
} from "../api/reports";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface TrivyStores {
  vulnerabilityReports: VulnerabilityReport[];
  configAuditReports: ConfigAuditReport[];
  sbomReports: SbomReport[];
  exposedSecretReports: ExposedSecretReport[];
  isReady: boolean;
  hasLoaded: boolean;
  gaveUp: boolean;
}

export function useTrivyStores(): TrivyStores {
  const vulnerabilityStore = useKubeStore(() =>
    VulnerabilityReport.getStore<VulnerabilityReport>(),
  );
  const configAuditStore = useKubeStore(() => ConfigAuditReport.getStore<ConfigAuditReport>());
  const sbomStore = useKubeStore(() => SbomReport.getStore<SbomReport>());
  const exposedSecretStore = useKubeStore(() =>
    ExposedSecretReport.getStore<ExposedSecretReport>(),
  );

  const scope = useNamespaceScope();
  const gaveUp = useLoadedStores(
    [vulnerabilityStore, configAuditStore, sbomStore, exposedSecretStore],
    scopeKey(scope),
    "a report kind",
  );

  return {
    vulnerabilityReports: withinScope(
      (vulnerabilityStore?.items ?? []) as VulnerabilityReport[],
      scope,
    ),
    configAuditReports: withinScope((configAuditStore?.items ?? []) as ConfigAuditReport[], scope),
    sbomReports: withinScope((sbomStore?.items ?? []) as SbomReport[], scope),
    exposedSecretReports: withinScope(
      (exposedSecretStore?.items ?? []) as ExposedSecretReport[],
      scope,
    ),
    isReady: Boolean(vulnerabilityStore),
    hasLoaded: Boolean(vulnerabilityStore?.isLoaded && sbomStore?.isLoaded),
    gaveUp,
  };
}
