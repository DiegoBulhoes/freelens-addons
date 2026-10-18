import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

import type { LoadState } from "../api/shared/store-state";
import { NamespaceFilter } from "../components/namespace-filter";
import { TrivyStyles } from "../components/styles";

const {
  Component: { Spinner },
} = Renderer;

export function PageHead({
  headline,
  subline,
  alarm = false,
}: {
  headline: ReactNode;
  subline: ReactNode;
  alarm?: boolean;
}) {
  return (
    <div className="Trivy-page__head">
      <div>
        <h1 className="Trivy-page__headline">{headline}</h1>
        <p className={`Trivy-page__subline${alarm ? " Trivy-page__subline--alarm" : ""}`}>
          {subline}
        </p>
      </div>
      <div className="Trivy-page__actions">
        <NamespaceFilter />
      </div>
    </div>
  );
}

/** What a page shows until its CRDs are registered and its lists have landed. */
export function PageGate({
  title,
  registered,
  state,
  waiting,
  unreachable,
}: {
  title: string;
  registered: boolean;
  state: LoadState;
  waiting: ReactNode;
  unreachable: ReactNode;
}) {
  if (!registered) {
    return (
      <div className="Trivy Trivy-page">
        <TrivyStyles />
        <PageHead headline={title} subline={waiting} />
      </div>
    );
  }

  return (
    <div className="Trivy Trivy-page">
      <TrivyStyles />
      {state === "unreachable" ? (
        <PageHead headline={title} subline={unreachable} alarm />
      ) : (
        <Spinner center />
      )}
    </div>
  );
}
