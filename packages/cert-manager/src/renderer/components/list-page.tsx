import { observer } from "mobx-react";
import { type ReactNode, useState } from "react";

import { describeCount, searchRows } from "../api/table";
import { NamespaceFilter } from "./namespace-filter";
import { type SelectionAction, SelectionBar } from "./selection-bar";
import { CertManagerStyles } from "./styles";
import { type Column, Table } from "./table";

export type { Column };

export interface ListPageProps<Row> {
  title: string;
  subline?: ReactNode;
  /** Marks the subline as the page's alarm. */
  alarm?: boolean;
  rows: Row[];
  columns: Column<Row>[];
  keyOf: (row: Row) => string;
  searchTexts: (row: Row) => string[];
  onOpen?: (row: Row) => void;
  openTitle?: (row: Row) => string;
  stateOf?: (row: Row) => string;
  empty: string;
  /** `data-section`, for an e2e suite to find the list. */
  section?: string;
  filters?: ReactNode;
  /** The page's one action, after the namespace selector. */
  action?: ReactNode;
  /** Ticks rows and offers these actions on them; a write to several types "confirm". */
  selection?: { hint: string; actions: SelectionAction<Row>[] };
  children?: ReactNode;
}

function ListPageView<Row>(props: ListPageProps<Row>) {
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const { rows } = props;

  const shown = searchRows(rows, query, props.searchTexts);
  // Only what is on screen counts: a row searched or filtered away drops out of the selection.
  const selected = shown.filter((row) => ticked.has(props.keyOf(row)));
  const toggle = (keys: string[], on: boolean) =>
    setTicked((before) => {
      const next = new Set(before);

      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }

      return next;
    });

  return (
    <div className="CertManager CertManager-page CertManager-page--list">
      <CertManagerStyles />
      <div className="CertManager-page__head">
        <div>
          <h1 className="CertManager-page__headline">
            {props.title}{" "}
            <span className="CertManager-page__count">
              {describeCount(shown.length, rows.length)}
            </span>
          </h1>
          {props.subline && (
            <p
              className={`CertManager-page__subline${props.alarm ? " CertManager-page__subline--alarm" : ""}`}
            >
              {props.subline}
            </p>
          )}
        </div>
        <div className="CertManager-page__actions">
          <input
            type="search"
            className="CertManager-search"
            placeholder="Search…"
            aria-label={`Search ${props.title.toLowerCase()}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <NamespaceFilter />
          {props.action}
        </div>
      </div>

      {props.filters}

      {props.selection && (
        <SelectionBar
          getItems={() => shown}
          pickOnlySelected={() => selected}
          hint={props.selection.hint}
          actions={props.selection.actions}
        />
      )}

      <section className="CertManager-section" data-section={props.section ?? "list"}>
        {shown.length === 0 ? (
          <p className="CertManager-section__note">
            {query ? "Nothing matches the search." : props.empty}
          </p>
        ) : (
          <Table
            rows={shown}
            columns={props.columns}
            keyOf={props.keyOf}
            onOpen={props.onOpen}
            openTitle={props.openTitle}
            stateOf={props.stateOf}
            selection={props.selection ? { ticked, toggle } : undefined}
          />
        )}
      </section>

      {props.children}
    </div>
  );
}

// `observer` drops the type parameter; without the cast, `Row` is `unknown`.
export const ListPage = observer(ListPageView) as <Row>(props: ListPageProps<Row>) => JSX.Element;
