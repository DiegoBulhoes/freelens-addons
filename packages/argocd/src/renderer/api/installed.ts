export const CRD_NAMES: readonly string[] = ["applications.argoproj.io"];

export function isInstalled(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (CRD_NAMES.includes(name)) return true;
  }

  return false;
}

// Image Updater v1.0 is the first with a CRD; before it there is no status to show.
export const IMAGE_UPDATER_CRD = "imageupdaters.argocd-image-updater.argoproj.io";

export function hasImageUpdater(crdNames: Iterable<string>): boolean {
  for (const name of crdNames) {
    if (name === IMAGE_UPDATER_CRD) return true;
  }

  return false;
}
