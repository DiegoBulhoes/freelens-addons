import { describeRefusal, renewalPatch, statusPath } from "./renewal";
import type { CertificateLike } from "./types";

/**
 * The one write this extension makes, and the one place it is sent from. Every
 * decision about it — whether to offer it, what the patch holds, what a refusal
 * means — is in `renewal.ts` and covered; this only carries it.
 *
 * Sent through the host's Kubernetes proxy on the frame's own origin, because the
 * extension API's KubeApi patches a resource and not its status subresource, and
 * a condition written to the resource itself is silently dropped by the API
 * server.
 */

/** The host's proxy, the path its own KubeApi requests go through. */
export const API_PROXY = "/api-kube";

export type RenewalOutcome = { ok: true } | { ok: false; message: string };

export async function renewCertificate(certificate: CertificateLike): Promise<RenewalOutcome> {
  const response = await fetch(`${API_PROXY}${statusPath(certificate)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/merge-patch+json" },
    body: JSON.stringify(renewalPatch(certificate, Date.now())),
  });

  if (response.ok) return { ok: true };

  let message: string | undefined;

  try {
    message = ((await response.json()) as { message?: string }).message;
  } catch {
    message = undefined;
  }

  return { ok: false, message: describeRefusal(response.status, message) };
}
