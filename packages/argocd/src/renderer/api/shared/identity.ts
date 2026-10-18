/** By namespace/name, not uid, so a pin survives the Application being recreated. */
export function idOf(object: { getName(): string; getNs(): string | undefined }): string {
  return keyFor(object.getName(), object.getNs());
}

export function descriptorOf(object: { getName(): string; getNs(): string | undefined }) {
  return { name: object.getName(), namespace: object.getNs() };
}

export function keyFor(name: string, namespace: string | undefined): string {
  return `${namespace ?? ""}/${name}`;
}

/** The key the route params name; undefined unless they name both. */
export function namedKey(
  name: string | undefined,
  namespace: string | undefined,
): string | undefined {
  return name && namespace ? keyFor(name, namespace) : undefined;
}
