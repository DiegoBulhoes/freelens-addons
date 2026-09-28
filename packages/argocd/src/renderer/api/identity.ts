/**
 * How the operator's marks name a cluster object. Namespaced rather than by
 * uid, so a mark survives an Application being deleted and recreated under the
 * same name — which is what a GitOps controller does routinely.
 */
export function idOf(object: { getName(): string; getNs(): string | undefined }): string {
  return `${object.getNs() ?? ""}/${object.getName()}`;
}
