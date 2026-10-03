import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { ArgoCDStyles } from "./styles";

const {
  Component: { WithTooltip },
} = Renderer;

export interface SelectionAction<Item> {
  label: string;
  tooltip: string;
  caution?: boolean;
  run: (items: Item[]) => void;
}

export interface SelectionBarProps<Item> {
  /** `parent.items` in `renderFooter`: the rows shown after the search. */
  getItems: () => Item[];
  pickOnlySelected: (items: Item[]) => Item[];
  hint: string;
  actions: SelectionAction<Item>[];
}

/** An observer because the host renders `renderFooter` untracked. */
function SelectionBarView<Item>({
  getItems,
  pickOnlySelected,
  hint,
  actions,
}: SelectionBarProps<Item>) {
  const selected = pickOnlySelected(getItems());

  if (selected.length === 0) return null;

  return (
    <div className="ArgoCD ArgoCD-selection" data-section="selection">
      <ArgoCDStyles />
      <div className="ArgoCD-selection__what">
        <span className="ArgoCD-selection__count">
          <b>{selected.length}</b> selected
        </span>
        <span className="ArgoCD-hint">{hint}</span>
      </div>
      <div className="ArgoCD-actions">
        {actions.map((action) => (
          <WithTooltip key={action.label} tooltip={action.tooltip}>
            <button
              type="button"
              className={`ArgoCD-button${action.caution ? " ArgoCD-button--caution" : ""}`}
              onClick={() => action.run(selected)}
            >
              {action.label}
            </button>
          </WithTooltip>
        ))}
      </div>
    </div>
  );
}

// `observer` drops the type parameter.
export const SelectionBar = observer(SelectionBarView) as <Item>(
  props: SelectionBarProps<Item>,
) => JSX.Element | null;
