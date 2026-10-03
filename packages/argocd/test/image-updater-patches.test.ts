import { describe, expect, it } from "vitest";

import {
  controllerNamespace,
  currentEdit,
  editedImageName,
  editImagePatch,
  invalidEdit,
  invertReplacements,
  isController,
  locateImages,
  planUndo,
  revertEditPatch,
  revertOverride,
  ruleCommands,
} from "../src/renderer/api/image-updater-patches";
import { recentUpdates, type UpdateRow } from "../src/renderer/api/image-updates";
import { application, applications, imageUpdater, imageUpdaters } from "./fixtures";
import { applyPatch } from "./json-patch";

function lastUpdateOf(rule: string): UpdateRow {
  const found = recentUpdates(imageUpdaters()).find((row) => row.updater === rule);

  if (!found) throw new Error(`${rule} has no update in the fixtures`);

  return found;
}

describe("finding an image in a rule", () => {
  it("points at the entry by its alias", () => {
    const [location] = locateImages(imageUpdater("podinfo-patches"), "podinfo");

    expect(location?.path).toBe("/spec/applicationRefs/0/images/0");
    expect(location?.image.imageName).toBe("ghcr.io/stefanprodan/podinfo:6.14.x");
  });

  it("finds nothing for an unknown alias, or a rule that reads annotations", () => {
    expect(locateImages(imageUpdater("podinfo-patches"), "nope")).toEqual([]);
    expect(locateImages(imageUpdater("from-annotations"), "podinfo")).toEqual([]);
  });
});

describe("editing an image", () => {
  const [location] = locateImages(imageUpdater("podinfo-patches"), "podinfo");
  if (!location) throw new Error("podinfo-patches has no podinfo image");

  it("opens with what the rule says", () => {
    expect(currentEdit(location)).toEqual({
      constraint: "6.14.x",
      strategy: "semver",
      allowTags: "",
    });
  });

  it("opens on semver for a strategy it does not offer, and takes the reference's", () => {
    const [frontend] = locateImages(imageUpdater("frontend-private"), "frontend");
    if (!frontend) throw new Error("frontend-private has no frontend image");

    expect(currentEdit(frontend).strategy).toBe("newest-build");
    expect(
      currentEdit({
        ...frontend,
        image: { ...frontend.image, commonUpdateSettings: { updateStrategy: "latest" } },
      }).strategy,
    ).toBe("semver");
    expect(
      currentEdit({
        ...frontend,
        image: { alias: "frontend", imageName: "gcr.io/x" },
        ref: { namePattern: "*", commonUpdateSettings: { updateStrategy: "digest" } },
      }).strategy,
    ).toBe("digest");
  });

  it("refuses a constraint with a colon or spaces, and a broken expression", () => {
    expect(
      invalidEdit({ constraint: "6.15.x", strategy: "semver", allowTags: "^6\\." }),
    ).toBeUndefined();
    expect(
      invalidEdit({ constraint: "podinfo:6.15.x", strategy: "semver", allowTags: "" }),
    ).toMatch(/colon/);
    expect(invalidEdit({ constraint: "6 .x", strategy: "semver", allowTags: "" })).toMatch(/colon/);
    expect(invalidEdit({ constraint: "", strategy: "semver", allowTags: "([" })).toMatch(
      /regular expression/,
    );
  });

  it("guards the image name, then writes the new constraint and settings on the image", () => {
    expect(
      editImagePatch(location, { constraint: "6.15.x", strategy: "semver", allowTags: "^6\\." }),
    ).toEqual([
      {
        op: "test",
        path: "/spec/applicationRefs/0/images/0/imageName",
        value: "ghcr.io/stefanprodan/podinfo:6.14.x",
      },
      {
        op: "replace",
        path: "/spec/applicationRefs/0/images/0/imageName",
        value: "ghcr.io/stefanprodan/podinfo:6.15.x",
      },
      {
        op: "add",
        path: "/spec/applicationRefs/0/images/0/commonUpdateSettings",
        // forceUpdate is the schema default the API server wrote in.
        value: { forceUpdate: false, updateStrategy: "semver", allowTags: "^6\\." },
      },
    ]);
  });

  it("drops the constraint and an emptied allow list", () => {
    const withTags = {
      ...location,
      image: {
        ...location.image,
        commonUpdateSettings: { updateStrategy: "semver", allowTags: "^6" },
      },
    };
    const patch = editImagePatch(withTags, { constraint: "", strategy: "digest", allowTags: "" });

    expect(patch[1]?.value).toBe("ghcr.io/stefanprodan/podinfo");
    expect(patch[2]?.value).toEqual({ updateStrategy: "digest" });
  });
});

describe("undoing an edit", () => {
  const rule = () => imageUpdater("podinfo-patches");
  const edit = { constraint: "6.15.x", strategy: "digest" as const, allowTags: "^6\\." };

  it("puts the image's name and settings back as they were", () => {
    const [location] = locateImages(rule(), "podinfo");
    if (!location) throw new Error("podinfo-patches has no podinfo image");

    const before = rule().toPlainObject();
    const edited = applyPatch(before, editImagePatch(location, edit));

    expect(edited).not.toEqual(before);
    expect(applyPatch(edited, revertEditPatch(location, edit))).toEqual(before);
  });

  it("removes the settings an edit added to an image that had none", () => {
    const [location] = locateImages(rule(), "podinfo");
    if (!location) throw new Error("podinfo-patches has no podinfo image");

    const bare = { ...location, image: { alias: "podinfo", imageName: location.image.imageName } };

    expect(revertEditPatch(bare, edit)[2]).toEqual({
      op: "remove",
      path: "/spec/applicationRefs/0/images/0/commonUpdateSettings",
    });
    expect(editedImageName(bare, { ...edit, constraint: "" })).toBe("ghcr.io/stefanprodan/podinfo");
  });

  it("is refused once the image was changed again since the edit", () => {
    const [location] = locateImages(rule(), "podinfo");
    if (!location) throw new Error("podinfo-patches has no podinfo image");

    const edited = applyPatch(rule().toPlainObject(), editImagePatch(location, edit));
    const changedAgain = applyPatch(edited, [
      {
        op: "replace",
        path: "/spec/applicationRefs/0/images/0/imageName",
        value: "ghcr.io/stefanprodan/podinfo:7.x",
      },
    ]);

    expect(() => applyPatch(changedAgain, revertEditPatch(location, edit))).toThrow(/test failed/);
  });
});

describe("inverting a replacement", () => {
  it("tests for what was written and puts back what was tested", () => {
    expect(
      invertReplacements([
        { op: "test", path: "/a", value: "old" },
        { op: "replace", path: "/a", value: "new" },
        { op: "replace", path: "/untested", value: "x" },
      ]),
    ).toEqual([
      { op: "test", path: "/a", value: "new" },
      { op: "replace", path: "/a", value: "old" },
    ]);
  });
});

describe("undoing the last update", () => {
  it("puts 6.13.0 back in the Kustomize override and, skipping, ignores 6.14.1 from now on", () => {
    const plan = planUndo(
      imageUpdater("podinfo-patches"),
      lastUpdateOf("podinfo-patches"),
      applications(),
      "skip",
    );

    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;

    expect(plan.applications.map((each) => each.application.getName())).toEqual(["image-updates"]);
    expect(plan.applications[0]?.patch).toEqual([
      {
        op: "test",
        path: "/spec/source/kustomize/images/0",
        value: "ghcr.io/stefanprodan/podinfo:6.14.1",
      },
      {
        op: "replace",
        path: "/spec/source/kustomize/images/0",
        value: "ghcr.io/stefanprodan/podinfo:6.13.0",
      },
    ]);
    expect(plan.rulePatch).toEqual([
      {
        op: "test",
        path: "/spec/applicationRefs/0/images/0/imageName",
        value: "ghcr.io/stefanprodan/podinfo:6.14.x",
      },
      {
        op: "add",
        path: "/spec/applicationRefs/0/images/0/commonUpdateSettings",
        value: { forceUpdate: false, updateStrategy: "semver", ignoreTags: ["6.14.1"] },
      },
    ]);
  });

  it("puts 6.13.0 back in the Helm tag parameter and, pinning, allows only 6.13.0", () => {
    const plan = planUndo(
      imageUpdater("podinfo-chart"),
      lastUpdateOf("podinfo-chart"),
      applications(),
      "pin",
    );

    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;

    const patch = plan.applications[0]?.patch ?? [];

    expect(patch[0]).toMatchObject({ op: "test", value: "6.14.1" });
    expect(patch[0]?.path).toMatch(/^\/spec\/source\/helm\/parameters\/\d+\/value$/);
    expect(patch[1]).toMatchObject({ op: "replace", path: patch[0]?.path, value: "6.13.0" });
    const pinned = plan.rulePatch[1]?.value as { allowTags: string };

    expect(pinned.allowTags).toBe("^6\\.13\\.0$");
    expect(new RegExp(pinned.allowTags).test("6.13.0")).toBe(true);
    expect(new RegExp(pinned.allowTags).test("6.13.01")).toBe(false);
  });

  it("keeps the tags already ignored, from wherever they were inherited", () => {
    const rule = imageUpdater("podinfo-patches");
    (rule.spec as { commonUpdateSettings?: object }).commonUpdateSettings = {
      ignoreTags: ["6.14.0"],
    };

    const plan = planUndo(rule, lastUpdateOf("podinfo-patches"), applications(), "skip");

    expect(plan.ok && plan.rulePatch[1]?.value).toMatchObject({
      ignoreTags: ["6.14.0", "6.14.1"],
    });
  });

  it("refuses when the controller did not say what it replaced", () => {
    const update = { ...lastUpdateOf("podinfo-patches"), from: undefined };

    expect(planUndo(imageUpdater("podinfo-patches"), update, applications(), "pin")).toEqual({
      ok: false,
      reason: expect.stringMatching(/which tag it replaced/),
    });
  });

  it("refuses when the rule no longer has that image", () => {
    const update = { ...lastUpdateOf("podinfo-patches"), alias: "gone" };

    expect(planUndo(imageUpdater("podinfo-patches"), update, applications(), "pin")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/no longer has an image called gone/),
    });
  });

  it("refuses for a rule that writes to git, where the update is a commit", () => {
    const rule = imageUpdater("podinfo-patches");
    rule.spec.writeBackConfig = { method: "git" };

    expect(planUndo(rule, lastUpdateOf("podinfo-patches"), applications(), "skip")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/revert it there/),
    });
  });

  it("refuses once the override has moved on", () => {
    const update = { ...lastUpdateOf("podinfo-patches"), to: "6.14.0" };

    expect(planUndo(imageUpdater("podinfo-patches"), update, applications(), "pin")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/No Application still carries 6.14.0/),
    });
  });

  it("finds a renamed Kustomize image, a full-image Helm parameter and a second source", () => {
    const image = { alias: "podinfo", imageName: "ghcr.io/stefanprodan/podinfo:6.14.x" };
    const renamed = application("image-updates");
    renamed.spec.source = {
      ...renamed.spec.source,
      kustomize: { images: ["podinfo=ghcr.io/stefanprodan/podinfo:6.14.1"] },
    };

    expect(revertOverride(renamed, image, "6.13.0", "6.14.1")?.[1]?.value).toBe(
      "podinfo=ghcr.io/stefanprodan/podinfo:6.13.0",
    );

    const multi = application("podinfo");
    const sources = multi.spec.sources ?? [];
    multi.spec.sources = [
      sources[0] ?? {},
      {
        ...sources[1],
        helm: {
          parameters: [{ name: "image.full", value: "ghcr.io/stefanprodan/podinfo:6.14.1" }],
        },
      },
    ];

    expect(
      revertOverride(
        multi,
        { ...image, manifestTargets: { helm: { spec: "image.full" } } },
        "6.13.0",
        "6.14.1",
      ),
    ).toEqual([
      {
        op: "test",
        path: "/spec/sources/1/helm/parameters/0/value",
        value: "ghcr.io/stefanprodan/podinfo:6.14.1",
      },
      {
        op: "replace",
        path: "/spec/sources/1/helm/parameters/0/value",
        value: "ghcr.io/stefanprodan/podinfo:6.13.0",
      },
    ]);

    const bare = application("guestbook");
    delete bare.spec.source;
    expect(revertOverride(bare, image, "6.13.0", "6.14.1")).toBeUndefined();
  });
});

describe("undoing an undo", () => {
  for (const [rule, mode] of [
    ["podinfo-patches", "skip"],
    ["podinfo-chart", "pin"],
  ] as const) {
    it(`puts the newer tag and ${rule}'s settings back after a ${mode}`, () => {
      const updater = imageUpdater(rule);
      const plan = planUndo(updater, lastUpdateOf(rule), applications(), mode);

      expect(plan).toMatchObject({ ok: true });
      if (!plan.ok) return;

      for (const { application: target, patch, reverse } of plan.applications) {
        const before = target.toPlainObject();

        expect(applyPatch(applyPatch(before, patch), reverse)).toEqual(before);
      }

      const before = updater.toPlainObject();

      expect(applyPatch(applyPatch(before, plan.rulePatch), plan.ruleReverse)).toEqual(before);
    });
  }

  it("refuses to restore the rule once its settings changed after the undo", () => {
    const updater = imageUpdater("podinfo-patches");
    const plan = planUndo(updater, lastUpdateOf("podinfo-patches"), applications(), "pin");

    if (!plan.ok) throw new Error("the undo was refused");

    const undone = applyPatch(updater.toPlainObject(), plan.rulePatch);
    const editedSince = applyPatch(undone, [
      {
        op: "replace",
        path: "/spec/applicationRefs/0/images/0/commonUpdateSettings/allowTags",
        value: "^7\\.",
      },
    ]);

    expect(() => applyPatch(editedSince, plan.ruleReverse)).toThrow(/test failed/);
  });

  it("removes the settings an undo added to an image that had none", () => {
    const updater = imageUpdater("podinfo-patches");
    const image = updater.spec.applicationRefs[0]?.images?.[0];

    if (image) delete image.commonUpdateSettings;

    const plan = planUndo(updater, lastUpdateOf("podinfo-patches"), applications(), "skip");

    expect(plan.ok && plan.ruleReverse.at(-1)).toEqual({
      op: "remove",
      path: "/spec/applicationRefs/0/images/0/commonUpdateSettings",
    });
  });
});

describe("commands and the controller", () => {
  it("names the rule and filters the controller's log by it", () => {
    const [yaml, logs] = ruleCommands(imageUpdater("frontend-private"), "argocd");

    expect(yaml?.command).toBe("kubectl -n argocd get imageupdater frontend-private -o yaml");
    expect(logs?.command).toContain("grep 'imageUpdater_name=frontend-private '");
  });

  it("recognises the controller from its manifest or its chart, and nothing else", () => {
    expect(isController({ "app.kubernetes.io/name": "argocd-image-updater-controller" })).toBe(
      true,
    );
    expect(isController({ "app.kubernetes.io/name": "argocd-image-updater" })).toBe(true);
    expect(isController({ "app.kubernetes.io/name": "argocd-server" })).toBe(false);
    expect(isController({})).toBe(false);
  });

  it("falls back to ArgoCD's namespace when the controller cannot be found", () => {
    expect(controllerNamespace([{ namespace: "tools" }], "argocd")).toBe("tools");
    expect(controllerNamespace([], "argocd")).toBe("argocd");
  });
});
