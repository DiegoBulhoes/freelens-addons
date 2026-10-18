import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import {
  findRule,
  IMAGE_COLUMNS,
  IMAGE_SORT,
  imageKey,
  imageSearchTexts,
  picksCell,
} from "../api/image-updater/image-updater-tables";
import {
  applyFilter,
  countWatching,
  filterNamed,
  IMAGE_FILTERS,
  type ImageFilter,
  type TrackedImage,
  trackedImages,
} from "../api/image-updater/image-updates";
import { describeRulesState, rankRules } from "../api/image-updater/rule-health";
import { emptyText } from "../api/shared/store-state";
import { locateImages } from "../api/writes/image-updater-patches";
import { RowDrawerLink } from "../components/drawer-link";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { useImageUpdaterStores } from "../hooks/use-image-updater-stores";
import { APPLICATIONS_PAGE } from "../pages/applications-page";
import { ApplicationLinks } from "./cells";
import { confirmEditImage } from "./dialogs";
import { ImageDrawer } from "./image-drawers";
import { RuleDrawer } from "./rule-drawer";

const {
  Component: { Icon, MenuItem },
} = Renderer;

export interface ImagesParams {
  filter?: { get(): string };
}

const FILTER_LABELS: Record<ImageFilter, string> = { watching: "Reach an Application" };
const FILTER_TITLES: Record<ImageFilter, string> = {
  watching: "Shows the images that reach an Application the controller updates",
};

export const ImageUpdaterImagesPage = observer(
  ({ extension, params }: { extension: Renderer.LensExtension; params?: ImagesParams }) => {
    const { updaters, applications, state, gap } = useImageUpdaterStores();
    const requested = filterNamed(IMAGE_FILTERS, params?.filter?.get());
    const [filter, setFilter] = useState<ImageFilter | undefined>(requested);

    // The page stays mounted when a card names another filter.
    useEffect(() => setFilter(requested), [requested]);
    const [opened, setOpened] = useState<{ image: string } | { rule: TrackedImage }>();
    const images = trackedImages(updaters, applications);
    const ranked = rankRules(updaters, applications, Date.now());
    const ruleOf = (image: TrackedImage) => findRule(ranked, image.updater, image.namespace);
    const image =
      opened && "image" in opened
        ? images.find((each) => imageKey(each) === opened.image)
        : undefined;
    const rule = opened && "rule" in opened ? ruleOf(opened.rule) : undefined;

    // A rule selects Applications in its own namespace only.
    const openApplication = (namespace: string | undefined) => (name: string) => {
      setOpened(undefined);
      void extension.navigate(APPLICATIONS_PAGE, { name, namespace: namespace ?? "" });
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
        cell: (image) => {
          const picks = picksCell(image);

          return (
            <span className="ArgoCD-mono" title={picks.title}>
              {picks.label}
            </span>
          );
        },
        sortValue: IMAGE_SORT[IMAGE_COLUMNS.picks],
      },
      {
        title: IMAGE_COLUMNS.applications,
        className: "ArgoCD-table__shrink",
        cell: (image) => (
          <ApplicationLinks image={image} onOpen={openApplication(image.namespace)} />
        ),
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
        cell: (image) => (
          <RowDrawerLink
            label={image.updater}
            title="Opens its rule"
            onOpen={() => setOpened({ rule: image })}
          />
        ),
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
        alarm={state === "unreachable" ? describeRulesState(state) : gap}
        section="image-updater-images"
        rows={applyFilter(images, IMAGE_FILTERS, filter)}
        filters={
          images.length > 0 && (
            <FilterChips
              filters={Object.keys(IMAGE_FILTERS) as ImageFilter[]}
              labels={FILTER_LABELS}
              titles={FILTER_TITLES}
              counts={{ watching: countWatching(images) }}
              current={filter}
              onChange={setFilter}
              section="image-updater-image-filters"
            />
          )
        }
        columns={columns}
        keyOf={imageKey}
        searchTexts={imageSearchTexts}
        onOpen={(row) => setOpened({ image: imageKey(row) })}
        menu={menu}
        empty={emptyText(
          state,
          describeRulesState,
          images.length > 0 ? "No image matches that filter." : "No rule names an image yet.",
        )}
      >
        <ImageDrawer
          image={image}
          rule={image ? ruleOf(image)?.updater : undefined}
          onClose={() => setOpened(undefined)}
          onOpenRule={() => image && setOpened({ rule: image })}
          onOpenApplication={openApplication(image?.namespace)}
        />
        <RuleDrawer
          updater={rule?.updater}
          health={rule?.health}
          applications={applications}
          onClose={() => setOpened(undefined)}
          onOpenApplication={openApplication(rule?.updater.getNs())}
        />
      </ListPage>
    );
  },
);
