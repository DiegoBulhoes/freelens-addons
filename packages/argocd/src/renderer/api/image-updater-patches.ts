import type { Application } from "./application";
import {
  type ApplicationRef,
  type CommonUpdateSettings,
  type ImageConfig,
  ImageUpdater,
} from "./image-updater";
import { selectApplications, splitImage, type UpdateRow } from "./image-updates";
import type { ApplicationSource } from "./types";

// Every write is a JSON patch that first `test`s the value it changes, so the API
// server refuses it if someone changed that value since the page read it.

export interface JsonPatchOperation {
  op: "test" | "replace" | "add" | "remove";
  path: string;
  value?: unknown;
}

export const STRATEGIES = ["semver", "newest-build", "alphabetical", "digest"] as const;

export type Strategy = (typeof STRATEGIES)[number];

/** Labels from both the controller's own manifest and its Helm chart. */
export const CONTROLLER_SELECTOR =
  "app.kubernetes.io/name in (argocd-image-updater-controller,argocd-image-updater)";

export interface ImageLocation {
  refIndex: number;
  imageIndex: number;
  ref: ApplicationRef;
  image: ImageConfig;
  path: string;
}

/** Annotation-configured references carry no images. */
export function locateImages(updater: ImageUpdater, alias: string): ImageLocation[] {
  const found: ImageLocation[] = [];

  ImageUpdater.getApplicationRefs(updater).forEach((ref, refIndex) => {
    (ref.images ?? []).forEach((image, imageIndex) => {
      if (image.alias === alias) {
        found.push({
          refIndex,
          imageIndex,
          ref,
          image,
          path: `/spec/applicationRefs/${refIndex}/images/${imageIndex}`,
        });
      }
    });
  });

  return found;
}

export interface ImageEdit {
  /** Empty for any tag. */
  constraint: string;
  strategy: Strategy;
  /** Empty for none. */
  allowTags: string;
}

export function currentEdit(location: ImageLocation): ImageEdit {
  const settings = location.image.commonUpdateSettings ?? {};
  const strategy = settings.updateStrategy ?? location.ref.commonUpdateSettings?.updateStrategy;

  return {
    constraint: splitImage(location.image.imageName).tag ?? "",
    strategy: STRATEGIES.includes(strategy as Strategy) ? (strategy as Strategy) : "semver",
    allowTags: settings.allowTags ?? "",
  };
}

export function invalidEdit(edit: ImageEdit): string | undefined {
  if (/[\s@]/.test(edit.constraint) || edit.constraint.includes(":")) {
    return "The constraint is only the part after the colon, without spaces, `:` or `@`.";
  }

  if (edit.allowTags) {
    try {
      new RegExp(edit.allowTags);
    } catch {
      return "Allowed tags is not a valid regular expression.";
    }
  }

  return undefined;
}

/** Settings go on the image itself, where they win over the reference's and the rule's. */
export function editImagePatch(location: ImageLocation, edit: ImageEdit): JsonPatchOperation[] {
  const settings = { ...location.image.commonUpdateSettings, updateStrategy: edit.strategy };

  if (edit.allowTags) settings.allowTags = edit.allowTags;
  else delete settings.allowTags;

  return [
    { op: "test", path: `${location.path}/imageName`, value: location.image.imageName },
    { op: "replace", path: `${location.path}/imageName`, value: editedImageName(location, edit) },
    { op: "add", path: `${location.path}/commonUpdateSettings`, value: settings },
  ];
}

export function editedImageName(location: ImageLocation, edit: ImageEdit): string {
  const { repository } = splitImage(location.image.imageName);

  return edit.constraint ? `${repository}:${edit.constraint}` : repository;
}

/** Tests for the name the edit wrote, so it refuses once someone else changed the image. */
export function revertEditPatch(location: ImageLocation, edit: ImageEdit): JsonPatchOperation[] {
  const previous = location.image.commonUpdateSettings;

  return [
    { op: "test", path: `${location.path}/imageName`, value: editedImageName(location, edit) },
    { op: "replace", path: `${location.path}/imageName`, value: location.image.imageName },
    previous
      ? { op: "add", path: `${location.path}/commonUpdateSettings`, value: previous }
      : { op: "remove", path: `${location.path}/commonUpdateSettings` },
  ];
}

/** Only for patches of `test` and `replace` pairs on the same path. */
export function invertReplacements(patch: JsonPatchOperation[]): JsonPatchOperation[] {
  const tested = new Map(
    patch.filter((operation) => operation.op === "test").map((each) => [each.path, each.value]),
  );

  return patch
    .filter((operation) => operation.op === "replace" && tested.has(operation.path))
    .flatMap((operation) => [
      { op: "test" as const, path: operation.path, value: operation.value },
      { op: "replace" as const, path: operation.path, value: tested.get(operation.path) },
    ]);
}

export interface ApplicationUndo {
  application: Application;
  patch: JsonPatchOperation[];
  reverse: JsonPatchOperation[];
}

// Restoring the old tag alone lasts one check: the rule still allows the newer one. `pin`
// allows only the old tag; `skip` ignores only the undone one, so another tag can win.
export type UndoMode = "pin" | "skip";

export type UndoPlan =
  | {
      ok: true;
      applications: ApplicationUndo[];
      rulePatch: JsonPatchOperation[];
      ruleReverse: JsonPatchOperation[];
    }
  | { ok: false; reason: string };

function sourcesOf(application: Application): { path: string; source: ApplicationSource }[] {
  const { source, sources } = application.spec;

  if (sources && sources.length > 0) {
    return sources.map((each, index) => ({ path: `/spec/sources/${index}`, source: each }));
  }

  return source ? [{ path: "/spec/source", source }] : [];
}

/** Wherever the controller wrote it: a Kustomize image entry or the rule's Helm parameter. */
export function revertOverride(
  application: Application,
  image: ImageConfig,
  from: string,
  to: string,
): JsonPatchOperation[] | undefined {
  const { repository } = splitImage(image.imageName);
  const helmTag = image.manifestTargets?.helm?.tag ?? "image.tag";
  const helmSpec = image.manifestTargets?.helm?.spec;

  for (const { path, source } of sourcesOf(application)) {
    const kustomizeImages = source.kustomize?.images ?? [];

    for (const [index, entry] of kustomizeImages.entries()) {
      // `name=repository:tag` when the image is renamed, `repository:tag` otherwise.
      const target = entry.includes("=") ? entry.slice(entry.indexOf("=") + 1) : entry;
      const parsed = splitImage(target);

      if (parsed.repository === repository && parsed.tag === to) {
        return [
          { op: "test", path: `${path}/kustomize/images/${index}`, value: entry },
          {
            op: "replace",
            path: `${path}/kustomize/images/${index}`,
            value: entry.replace(new RegExp(`:${escapeRegExpText(to)}$`), `:${from}`),
          },
        ];
      }
    }

    for (const [index, parameter] of (source.helm?.parameters ?? []).entries()) {
      const isTag = parameter.name === helmTag && parameter.value === to;
      const isSpec = helmSpec !== undefined && parameter.name === helmSpec;

      if (isTag || (isSpec && parameter.value === `${repository}:${to}`)) {
        return [
          { op: "test", path: `${path}/helm/parameters/${index}/value`, value: parameter.value },
          {
            op: "replace",
            path: `${path}/helm/parameters/${index}/value`,
            value: isTag ? from : `${repository}:${from}`,
          },
        ];
      }
    }
  }

  return undefined;
}

function escapeRegExpText(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function planUndo(
  updater: ImageUpdater,
  update: UpdateRow,
  applications: Application[],
  mode: UndoMode,
): UndoPlan {
  if (!update.from) {
    return { ok: false, reason: "The controller's record does not say which tag it replaced." };
  }

  const locations = locateImages(updater, update.alias);

  if (locations.length === 0) {
    return {
      ok: false,
      reason: `The rule no longer has an image called ${update.alias}, or reads it from annotations.`,
    };
  }

  const reached = selectApplications(updater, applications);
  const undos: ApplicationUndo[] = [];

  for (const location of locations) {
    for (const selection of reached.filter((each) => each.ref === location.ref)) {
      if ((selection.writeBack.method ?? "argocd").startsWith("git")) {
        return {
          ok: false,
          reason: "This rule writes to git. The update is a commit: revert it there.",
        };
      }

      const patch = revertOverride(selection.application, location.image, update.from, update.to);

      if (patch) {
        undos.push({
          application: selection.application,
          patch,
          reverse: invertReplacements(patch),
        });
      }
    }
  }

  if (undos.length === 0) {
    return {
      ok: false,
      reason: `No Application still carries ${update.to}: it was changed or undone since.`,
    };
  }

  const from = update.from;
  const settingsFor = (location: ImageLocation) => {
    const settings = location.image.commonUpdateSettings ?? {};
    const inherited =
      location.ref.commonUpdateSettings?.ignoreTags ??
      updater.spec.commonUpdateSettings?.ignoreTags ??
      [];

    return mode === "pin"
      ? { ...settings, allowTags: `^${escapeRegExpText(from)}$` }
      : {
          ...settings,
          ignoreTags: [...new Set([...(settings.ignoreTags ?? inherited), update.to])],
        };
  };

  const guard = (location: ImageLocation) => ({
    op: "test" as const,
    path: `${location.path}/imageName`,
    value: location.image.imageName,
  });

  const rulePatch = locations.flatMap((location) => [
    guard(location),
    {
      op: "add" as const,
      path: `${location.path}/commonUpdateSettings`,
      value: settingsFor(location),
    },
  ]);

  const ruleReverse = locations.flatMap((location): JsonPatchOperation[] => {
    const written: CommonUpdateSettings = settingsFor(location);
    const field = mode === "pin" ? "allowTags" : "ignoreTags";
    const previous = location.image.commonUpdateSettings;

    return [
      guard(location),
      { op: "test", path: `${location.path}/commonUpdateSettings/${field}`, value: written[field] },
      previous
        ? { op: "add", path: `${location.path}/commonUpdateSettings`, value: previous }
        : { op: "remove", path: `${location.path}/commonUpdateSettings` },
    ];
  });

  return { ok: true, applications: undos, rulePatch, ruleReverse };
}

export interface Command {
  label: string;
  command: string;
}

export function ruleCommands(updater: ImageUpdater, controllerNamespace: string): Command[] {
  const name = updater.getName();
  const namespace = updater.metadata.namespace as string;

  return [
    {
      label: "The rule, as the cluster has it",
      command: `kubectl -n ${namespace} get imageupdater ${name} -o yaml`,
    },
    {
      label: "Its warnings and errors from the controller's log",
      command: `kubectl -n ${controllerNamespace} logs deploy/argocd-image-updater-controller --since=1h | grep 'imageUpdater_name=${name} ' | grep -E 'level=(warning|error)'`,
    },
  ];
}

export function isController(labels: Partial<Record<string, string>>): boolean {
  const name = labels["app.kubernetes.io/name"];

  return name === "argocd-image-updater-controller" || name === "argocd-image-updater";
}

export function controllerNamespace(found: { namespace: string }[], fallback: string): string {
  return found[0]?.namespace ?? fallback;
}
