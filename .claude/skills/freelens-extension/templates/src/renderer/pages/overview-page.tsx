import { StatCard } from "../components/stat-card";
import { __Name__Styles } from "../components/styles";

// Keep the page and headline class names: the e2e layout suite reads them.
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
