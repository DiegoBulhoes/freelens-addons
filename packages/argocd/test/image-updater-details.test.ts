import { describe, expect, it } from "vitest";

import {
  applicationsOfUpdate,
  editTarget,
  imageState,
  undoPreview,
  updateState,
} from "../src/renderer/api/image-updater-details";
import { findRule, imageKey, ruleKey, updateKey } from "../src/renderer/api/image-updater-tables";
import {
  rankRules,
  recentUpdates,
  type TrackedImage,
  trackedImages,
  type UpdateRow,
} from "../src/renderer/api/image-updates";
import {
  applications,
  fixtureNow,
  imageUpdater,
  imageUpdaters,
  statusOf,
  variantOf,
} from "./fixtures";

const images = () => trackedImages(imageUpdaters(), applications());

function imageOf(rule: string): TrackedImage {
  const found = images().find((image) => image.updater === rule);

  if (!found) throw new Error(`no image in rule ${rule}`);

  return found;
}

function updateOf(rule: string): UpdateRow {
  const found = recentUpdates(imageUpdaters()).find((update) => update.updater === rule);

  if (!found) throw new Error(`no update by rule ${rule}`);

  return found;
}

describe("an image's state in its drawer", () => {
  it("warns when its rule reaches no Application", () => {
    const state = imageState(imageOf("retired"));

    expect(state.tone).toBe("warning");
    expect(state.label).toBe("reaches nothing");
    expect(state.reason).toContain("retired");
  });

  it("warns, with the cause, when the controller skips every Application it reaches", () => {
    const state = imageState(imageOf("plain-manifests"));

    expect(state.label).toBe("nothing updatable");
    expect(state.reason).toMatch(/guestbook-pinned: it is a directory source/);
  });

  it("says which Application does not run the image", () => {
    const notRunning = variantOf("image-updates", (data) => {
      statusOf(data).summary = { images: [] };
    });
    const [image] = trackedImages([imageUpdater("podinfo-patches")], [notRunning]);
    const state = imageState(image as TrackedImage);

    expect(state.tone).toBe("info");
    expect(state.reason).toMatch(/^image-updates does not run ghcr\.io\/stefanprodan\/podinfo/);
  });

  it("says how a tag is picked when it is watching", () => {
    expect(imageState(imageOf("podinfo-patches"))).toEqual({
      tone: "ok",
      label: "watching",
      reason: "Updated on 1 Application by semver within 6.14.x.",
    });
    expect(imageState(imageOf("frontend-private")).reason).toBe(
      "Updated on 1 Application by newest-build.",
    );
  });
});

describe("editing an image from its drawer", () => {
  it("writes to the image's entry in its rule", () => {
    const target = editTarget(imageOf("podinfo-patches"), imageUpdater("podinfo-patches"));

    expect(target).toHaveProperty("location.path", "/spec/applicationRefs/0/images/0");
  });

  it("is not offered for annotations, a rule gone, or an image the rule dropped", () => {
    expect(editTarget(imageOf("from-annotations"), imageUpdater("from-annotations"))).toEqual({
      reason: "Its settings are the Application's annotations: change them there.",
    });
    expect(editTarget(imageOf("podinfo-patches"), undefined)).toEqual({
      reason: "Rule podinfo-patches is no longer in the cluster.",
    });
    expect(
      editTarget({ ...imageOf("podinfo-patches"), alias: "gone" }, imageUpdater("podinfo-patches")),
    ).toEqual({ reason: "Rule podinfo-patches no longer has an image called gone." });
  });
});

describe("an update in its drawer", () => {
  it("lists the Applications its rule reaches for that image, and the tag each runs", () => {
    expect(applicationsOfUpdate(updateOf("podinfo-patches"), images())).toEqual([
      { name: "image-updates", running: "6.14.1" },
    ]);
  });

  it("lists an Application once when two entries of the rule reach it", () => {
    const image = imageOf("podinfo-patches");

    expect(applicationsOfUpdate(updateOf("podinfo-patches"), [image, image])).toHaveLength(1);
  });

  it("can be undone while the Applications still carry the new tag", () => {
    const update = updateOf("podinfo-patches");
    const state = updateState(
      update,
      undoPreview(update, imageUpdater("podinfo-patches"), applications()),
    );

    expect(state.tone).toBe("ok");
    expect(state.reason).toBe(
      "Moved podinfo from 6.13.0 to 6.14.1 on 1 Application. The controller keeps only its rule's most recent update.",
    );
  });

  it("says why it cannot be undone from here", () => {
    const update = updateOf("podinfo-patches");

    expect(updateState(update, undoPreview(update, undefined, applications()))).toEqual({
      tone: "warning",
      label: "cannot be undone here",
      reason: "Rule podinfo-patches is no longer in the cluster.",
    });
    expect(
      updateState(
        { ...update, from: undefined },
        undoPreview({ ...update, from: undefined }, imageUpdater("podinfo-patches"), []),
      ).reason,
    ).toMatch(/does not say which tag it replaced/);
  });
});

describe("keys and lookups the pages open drawers by", () => {
  it("tells every image and every update apart", () => {
    const all = images();

    expect(new Set(all.map(imageKey)).size).toBe(all.length);
    expect(imageKey(imageOf("podinfo-patches"))).toBe(
      "argocd/podinfo-patches/podinfo/image-updates",
    );

    const updates = recentUpdates(imageUpdaters());

    expect(new Set(updates.map(updateKey)).size).toBe(updates.length);
    expect(updateKey(updateOf("podinfo-chart"))).toBe("argocd/podinfo-chart/podinfo/6.14.1");
  });

  it("finds a rule by name and namespace", () => {
    const rows = rankRules(imageUpdaters(), applications(), fixtureNow());

    expect(findRule(rows, "retired", "argocd")?.updater.getName()).toBe("retired");
    expect(findRule(rows, "retired", "elsewhere")).toBeUndefined();
    expect(ruleKey("retired", undefined)).toBe("/retired");
  });
});
