import { describeRefusal, renewalPatch, statusPath } from "./renewal";
import type { CertificateLike } from "./types";

// Through the host proxy: the extension KubeApi cannot patch the status subresource,
// and conditions written to the resource itself are silently dropped.

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
