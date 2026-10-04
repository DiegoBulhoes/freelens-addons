import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { MongoDBStyles } from "./styles";

const {
  Component: { WithTooltip },
} = Renderer;

export interface SelectionAction<Item> {
  label: string;
  tooltip: string;
  /** A cluster write: placed last, confirmed by typing "confirm". */
  caution?: boolean;
  run: (items: Item[]) => void;
}

export interface SelectionBarProps<Item> {
  /** `parent.items` in `renderFooter`: the rows shown after the host's search. */
  getItems: () => Item[];
  pickOnlySelected: (items: Item[]) => Item[];
  hint: string;
  actions: SelectionAction<Item>[];
}

// The host renders `renderFooter` untracked, so this observes the selection itself.
function SelectionBarView<Item>({
  getItems,
  pickOnlySelected,
  hint,
  actions,
}: SelectionBarProps<Item>) {
  const selected = pickOnlySelected(getItems());

  if (selected.length === 0) return null;

  return (
    <div className="MongoDB MongoDB-selection" data-section="selection">
      <MongoDBStyles />
      <div className="MongoDB-selection__what">
        <span className="MongoDB-selection__count">
          <b>{selected.length}</b> selected
        </span>
        <span className="MongoDB-hint">{hint}</span>
      </div>
      <div className="MongoDB-actions">
        {actions.map((action) => (
          <WithTooltip key={action.label} tooltip={action.tooltip}>
            <button
              type="button"
              className={`MongoDB-button${action.caution ? " MongoDB-button--caution" : ""}`}
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
