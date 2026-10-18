export const CRD_NAMES: readonly string[] = ["applications.argoproj.io"];

function hasAnyCrd(crdNames: Iterable<string>, wanted: readonly string[]): boolean {
  for (const name of crdNames) {
    if (wanted.includes(name)) return true;
  }

  return false;
}

export function isInstalled(crdNames: Iterable<string>): boolean {
  return hasAnyCrd(crdNames, CRD_NAMES);
}

// Image Updater v1.0 is the first with a CRD; before it there is no status to show.
export const IMAGE_UPDATER_CRD = "imageupdaters.argocd-image-updater.argoproj.io";

export function hasImageUpdater(crdNames: Iterable<string>): boolean {
  return hasAnyCrd(crdNames, [IMAGE_UPDATER_CRD]);
}

export const APPLICATION_SET_CRD = "applicationsets.argoproj.io";

export function hasApplicationSets(crdNames: Iterable<string>): boolean {
  return hasAnyCrd(crdNames, [APPLICATION_SET_CRD]);
}
