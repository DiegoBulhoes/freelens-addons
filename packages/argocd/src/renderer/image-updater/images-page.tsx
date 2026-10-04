import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import { locateImages } from "../api/image-updater-patches";
import {
  findRule,
  IMAGE_COLUMNS,
  IMAGE_SORT,
  imageKey,
  imageSearchTexts,
} from "../api/image-updater-tables";
import {
  countWatching,
  describeRulesState,
  rankRules,
  type TrackedImage,
  trackedImages,
} from "../api/image-updates";
import { type Column, ListPage } from "../components/list-page";
import { useImageUpdaterStores } from "../hooks/use-image-updater-stores";
import { confirmEditImage } from "./dialogs";
import { ImageDrawer } from "./image-drawers";
import { RuleDrawer } from "./rule-drawer";
import { ApplicationLinks, describeChoice } from "./shared";

const {
  Component: { Icon, MenuItem },
} = Renderer;

export const ImageUpdaterImagesPage = observer(
  ({ extension }: { extension: Renderer.LensExtension }) => {
    const { updaters, applications, state } = useImageUpdaterStores();
    const [opened, setOpened] = useState<{ image: string } | { rule: TrackedImage }>();
    const images = trackedImages(updaters, applications);
    const ranked = rankRules(updaters, applications, Date.now());
    const ruleOf = (image: TrackedImage) => findRule(ranked, image.updater, image.namespace);
    const image =
      opened && "image" in opened
        ? images.find((each) => imageKey(each) === opened.image)
        : undefined;
    const rule = opened && "rule" in opened ? ruleOf(opened.rule) : undefined;

    const openApplication = (name: string) => {
      setOpened(undefined);
      void extension.navigate("applications", { name });
    };

    const columns: Column<TrackedImage>[] = [
      {
        title: IMAGE_COLUMNS.image,
        className: "ArgoCD-table__fill",
        cell: (image) => (
          <span title={image.repository}>
            {image.alias}
            <span className="ArgoCD-muted"> · {image.repository}</span>
          </span>
        ),
        sortValue: IMAGE_SORT[IMAGE_COLUMNS.image],
      },
      {
        title: IMAGE_COLUMNS.picks,
        className: "ArgoCD-table__shrink",
        cell: (image) => <span className="ArgoCD-mono">{describeChoice(image)}</span>,
        sortValue: IMAGE_SORT[IMAGE_COLUMNS.picks],
      },
      {
        title: IMAGE_COLUMNS.applications,
        className: "ArgoCD-table__shrink",
        cell: (image) => <ApplicationLinks image={image} onOpen={openApplication} />,
        sortValue: IMAGE_SORT[IMAGE_COLUMNS.applications],
      },
      {
        title: IMAGE_COLUMNS.writesTo,
        className: "ArgoCD-table__shrink",
        cell: (image) => (
          <span
            className="ArgoCD-muted"
            title={`${image.writeBack}${image.fromAnnotations ? ", configured in its annotations" : ""}`}
          >
            {image.writesToGit ? "git" : "Application"}
            {image.fromAnnotations && " · annotations"}
          </span>
        ),
        sortValue: IMAGE_SORT[IMAGE_COLUMNS.writesTo],
      },
      {
        title: IMAGE_COLUMNS.rule,
        className: "ArgoCD-table__shrink",
        cell: (image) => <span className="ArgoCD-muted">{image.updater}</span>,
        sortValue: IMAGE_SORT[IMAGE_COLUMNS.rule],
      },
    ];

    const menu = (image: TrackedImage) => {
      const rule = ruleOf(image)?.updater;
      const [location] = rule && !image.fromAnnotations ? locateImages(rule, image.alias) : [];

      if (!rule || !location) return null;

      return (
        <MenuItem onClick={() => confirmEditImage(rule, location)}>
          <Icon
            material="edit"
            tooltip="Changes the constraint, the strategy and the allowed tags. Asks first"
          />
          <span className="title">Edit</span>
        </MenuItem>
      );
    };

    return (
      <ListPage
        title="Watched images"
        subline={
          images.length > 0
            ? `${countWatching(images)} of ${images.length} reach an Application the controller updates. A row opens the image.`
            : undefined
        }
        alarm={state === "unreachable" ? describeRulesState(state) : undefined}
        note={state === "unreachable" ? undefined : describeRulesState(state)}
        section="image-updater-images"
        rows={images}
        columns={columns}
        keyOf={imageKey}
        searchTexts={imageSearchTexts}
        onOpen={(row) => setOpened({ image: imageKey(row) })}
        menu={menu}
        empty="No rule names an image yet."
      >
        <ImageDrawer
          image={image}
          rule={image ? ruleOf(image)?.updater : undefined}
          onClose={() => setOpened(undefined)}
          onOpenRule={() => image && setOpened({ rule: image })}
          onOpenApplication={openApplication}
        />
        <RuleDrawer
          updater={rule?.updater}
          health={rule?.health}
          applications={applications}
          onClose={() => setOpened(undefined)}
          onOpenApplication={openApplication}
        />
      </ListPage>
    );
  },
);
