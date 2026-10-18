import type { Command } from "../shared/commands";
import { refreshPatch } from "../writes/patches";
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

const namespaceOf = (application: Application) => application.getNs() ?? "argocd";

function getApplicationCommand(application: Application): string {
  return `kubectl -n ${namespaceOf(application)} get application ${application.getName()} -o yaml`;
}

export function kubectlCommand(application: Application, action: CliAction): string {
  const name = application.getName();
  const namespace = namespaceOf(application);
  const patch = (body: string) =>
    `kubectl -n ${namespace} patch application ${name} --type merge -p '${body}'`;

  switch (action) {
    case "sync":
      return patch('{"operation":{"sync":{"prune":false}}}');
    case "refresh":
      return patch(JSON.stringify(refreshPatch("normal")));
    case "hard-refresh":
      return patch(JSON.stringify(refreshPatch("hard")));
    case "diff":
    case "get":
      return getApplicationCommand(application);
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

/** The controller's own label: its StatefulSet is found whatever the install named it. */
export const APPLICATION_CONTROLLER_LABEL = "app.kubernetes.io/name=argocd-application-controller";

export function applicationCommands(application: Application): Command[] {
  const name = application.getName();
  const namespace = namespaceOf(application);
  const controlPlane = Application.getControlPlaneNamespace(application) ?? namespace;

  return [
    {
      label: "The Application, as the cluster has it",
      command: getApplicationCommand(application),
    },
    { label: "What differs from git", command: argocdCommand(application, "diff") },
    {
      label: "Its events",
      command: `kubectl -n ${namespace} get events --field-selector involvedObject.kind=Application,involvedObject.name=${name}`,
    },
    {
      label: "Its warnings and errors from the controller's log",
      command: `kubectl -n ${controlPlane} logs -l ${APPLICATION_CONTROLLER_LABEL} --since=1h --tail=-1 | grep -E 'application=${name}( |$)' | grep -E 'level=(warning|error)'`,
    },
  ];
}
