import { StatCard } from "../components/stat-card";
import { __Name__Styles } from "../components/styles";

/**
 * The scaffold's only page. It exists so `make up` has something to show in the
 * sidebar and `pages-render.e2e.ts` has a headline to read; the first store hook
 * and the first decision module replace its contents.
 *
 * Built from the design standard (design.md in the skill): the root class for
 * the tokens, a page, its head, a row of cards. Keep the page and headline class
 * names: the e2e layout suite reads the headline's colour and the page's width
 * by them.
 */
export function OverviewPage() {
  return (
    <div className="__Name__ __Name__-page">
      <__Name__Styles />
      <div className="__Name__-page__head">
        <div>
          <h1 className="__Name__-page__headline">__TITLE__</h1>
          <p className="__Name__-page__subline">Loaded. Nothing is read from the cluster yet.</p>
        </div>
      </div>
      <div className="__Name__-cards">
        <StatCard value={0} label="Objects read" />
      </div>
    </div>
  );
}
