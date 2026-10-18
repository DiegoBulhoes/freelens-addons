import type { Application } from "../applications/application";
import type { DrawerState } from "../shared/drawer-state";
import { plural } from "../shared/text";
import {
  type ImageLocation,
  locateImages,
  planUndo,
  type UndoPlan,
} from "../writes/image-updater-patches";
import type { ImageUpdater } from "./image-updater";
import type { TrackedImage, UpdateRow, WatchedApplication } from "./image-updates";

export function imageState(image: TrackedImage): DrawerState {
  const { applications } = image;

  if (applications.length === 0) {
    return {
      tone: "warning",
      label: "reaches nothing",
      reason: `Rule ${image.updater} matches no Application in ${image.namespace}, so this image is updated nowhere.`,
    };
  }

  const updatable = applications.filter((watched) => !watched.skipped);
  const [skipped] = applications.filter((watched) => watched.skipped);

  if (updatable.length === 0 && skipped) {
    return {
      tone: "warning",
      label: "nothing updatable",
      reason: `The controller skips ${skipped.name}: ${skipped.skipped}.`,
    };
  }

  const absent = updatable.filter((watched) => watched.running === undefined);

  if (absent.length > 0) {
    return {
      tone: "info",
      label: "not running",
      reason: `${absent.map((watched) => watched.name).join(", ")} ${absent.length === 1 ? "does" : "do"} not run ${image.repository}, so the controller has no tag to replace there.`,
    };
  }

  return {
    tone: "ok",
    label: "watching",
    reason: `Updated on ${plural(updatable.length, "Application")} by ${image.strategy}${image.constraint ? ` within ${image.constraint}` : ""}.`,
  };
}

/** Where Edit writes, or why the drawer offers no Edit. */
export function editTarget(
  image: TrackedImage,
  rule: ImageUpdater | undefined,
): { location: ImageLocation } | { reason: string } {
  if (!rule) return { reason: `Rule ${image.updater} is no longer in the cluster.` };
  if (image.fromAnnotations) {
    return { reason: "Its settings are the Application's annotations: change them there." };
  }

  const [location] = locateImages(rule, image.alias);

  return location
    ? { location }
    : { reason: `Rule ${image.updater} no longer has an image called ${image.alias}.` };
}

/** The Applications the update's image reaches through its rule, each once. */
export function applicationsOfUpdate(
  update: UpdateRow,
  images: TrackedImage[],
): WatchedApplication[] {
  const seen = new Map<string, WatchedApplication>();

  for (const image of images) {
    if (
      image.updater !== update.updater ||
      image.namespace !== update.namespace ||
      image.alias !== update.alias
    ) {
      continue;
    }

    for (const watched of image.applications) {
      if (!seen.has(watched.name)) seen.set(watched.name, watched);
    }
  }

  return [...seen.values()];
}

export function updateState(update: UpdateRow, undo: UndoPlan): DrawerState {
  if (!undo.ok) {
    return { tone: "warning", label: "cannot be undone here", reason: undo.reason };
  }

  return {
    tone: "ok",
    label: "updated",
    reason: `Moved ${update.alias} from ${update.from} to ${update.to} on ${plural(update.applications, "Application")}. The controller keeps only its rule's most recent update.`,
  };
}

/** What Undo would do now, previewed as the confirmation does, pinning. */
export function undoPreview(
  update: UpdateRow,
  rule: ImageUpdater | undefined,
  applications: Application[],
): UndoPlan {
  if (!rule) return { ok: false, reason: `Rule ${update.updater} is no longer in the cluster.` };

  return planUndo(rule, update, applications, "pin");
}

/** Why Undo is not offered for an update, or undefined when it is. */
export function undoRefusal(
  update: UpdateRow,
  rule: ImageUpdater | undefined,
  applications: Application[],
): string | undefined {
  const preview = undoPreview(update, rule, applications);

  return preview.ok ? undefined : preview.reason;
}
