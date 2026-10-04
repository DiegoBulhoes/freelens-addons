import type { Problem } from "./attention";
import type { ChainLink } from "./chain";
import type { CertificateLike } from "./types";

export interface Command {
  label: string;
  command: string;
}

function namespaceFlag(namespace: string | undefined): string {
  return namespace ? ` -n ${namespace}` : "";
}

function describeLink(link: ChainLink): Command {
  const kind = link.kind.toLowerCase();

  return {
    label: `Describe the ${link.kind} causing it`,
    command: `kubectl describe ${kind} ${link.name}${namespaceFlag(link.namespace)}`,
  };
}

// Renewal last: it only helps once the object that explains the failure is fixed.
export function commandsFor(
  certificate: CertificateLike,
  problem: Problem | undefined,
  explanation: ChainLink | undefined,
): Command[] {
  const target = `${certificate.getName()}${namespaceFlag(certificate.getNs())}`;
  const commands: Command[] = [
    {
      label: "Its full status, from cert-manager",
      command: `cmctl status certificate ${target}`,
    },
  ];

  if (explanation && explanation.kind !== "Certificate" && explanation.state !== "missing") {
    commands.push(describeLink(explanation));
  }

  if (problem === "expired" || problem === "renewal-overdue") {
    commands.push({
      label: "Renew it, once the cause is fixed",
      command: `cmctl renew ${target}`,
    });
  }

  return commands;
}

export function issuerCommands(
  kind: "Issuer" | "ClusterIssuer",
  name: string,
  namespace?: string,
): Command[] {
  return [
    {
      label: `Its full status and events`,
      command: `kubectl describe ${kind.toLowerCase()} ${name}${namespaceFlag(namespace)}`,
    },
  ];
}
