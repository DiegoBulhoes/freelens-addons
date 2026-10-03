/** By namespace/name, not uid, so a mark survives the Application being recreated. */
export function idOf(object: { getName(): string; getNs(): string | undefined }): string {
  return `${object.getNs() ?? ""}/${object.getName()}`;
}
