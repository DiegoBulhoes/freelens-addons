import { Application } from "./application";

export type CliAction = "sync" | "refresh" | "hard-refresh" | "diff" | "get";

export function argocdCommand(application: Application, action: CliAction): string {
  const name = application.getName();
  const namespace = application.getNs();
  const target = namespace ? `${namespace}/${name}` : name;

  switch (action) {
    case "sync":
      return `argocd app sync ${target}`;
    case "diff":
      return `argocd app diff ${target}`;
    case "refresh":
      return `argocd app get ${target} --refresh`;
    case "hard-refresh":
      return `argocd app get ${target} --hard-refresh`;
    case "get":
      return `argocd app get ${target}`;
  }
}

export function kubectlCommand(application: Application, action: CliAction): string {
  const name = application.getName();
  const namespace = application.getNs() ?? "argocd";
  const patch = (body: string) =>
    `kubectl -n ${namespace} patch application ${name} --type merge -p '${body}'`;

  switch (action) {
    case "sync":
      return patch('{"operation":{"sync":{"prune":false}}}');
    case "refresh":
      return patch('{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"normal"}}}');
    case "hard-refresh":
      return patch('{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}');
    case "diff":
    case "get":
      return `kubectl -n ${namespace} get application ${name} -o yaml`;
  }
}

export function describeForHandover(application: Application): string {
  const rollup = Application.getResourceRollup(application);

  return [
    `${application.getName()} (${Application.getProject(application)} → ${Application.getDestination(application)})`,
    `  sync:   ${Application.getSyncStatus(application)}${rollup.outOfSync > 0 ? ` — ${rollup.outOfSync} of ${rollup.total} resources differ` : ""}`,
    `  health: ${Application.getHealthStatus(application)}${Application.getHealthMessage(application) ? ` — ${Application.getHealthMessage(application)}` : ""}`,
    `  rev:    ${Application.getRevision(application) ?? "unknown"}`,
    `  auto:   ${Application.isAutoSynced(application) ? "on" : "off"}`,
    `  cmd:    ${argocdCommand(application, "get")}`,
  ].join("\n");
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
