import type { Problem } from "./attention";
import type { ChainLink } from "./chain";
import type { CertificateLike } from "./types";

/**
 * The command that would help, as text to copy. The one write the extension
 * makes — a renewal — is a button of its own (`renewal.ts`); the renew command is
 * still listed, for whoever would rather run it.
 *
 * `cmctl` is cert-manager's own CLI. Where kubectl can say the same thing, the
 * kubectl line is given, because kubectl is already installed everywhere.
 */

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

/**
 * Always the status of the certificate. Then, when something is wrong, the
 * object that explains it; and for a certificate that is expired or failing to
 * renew, the manual renewal — which only helps once that object is fixed, and
 * is listed after it for that reason.
 */
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
