import { Fragment } from "react";

import { type Fact, type LinkTarget, linkTitle } from "../api/shared/facts";
import type { Verdict } from "../api/shared/verdict";
import { DrawerLink } from "./drawer-link";
import { Status } from "./status";

/** `onFollow` draws a fact's linked parts as links; it must close the drawer first. */
export function Facts({ facts, onFollow }: { facts: Fact[]; onFollow?: (to: LinkTarget) => void }) {
  return (
    <>
      {facts.map(({ term, value, parts }) => (
        <div key={term} style={{ display: "contents" }}>
          <dt>{term}</dt>
          <dd>
            {parts && onFollow
              ? parts.map((part, index) => (
                  <Fragment key={part.text}>
                    {index > 0 && ", "}
                    {part.to ? (
                      <FactLink to={part.to} onFollow={onFollow}>
                        {part.text}
                      </FactLink>
                    ) : (
                      part.text
                    )}
                  </Fragment>
                ))
              : value}
          </dd>
        </div>
      ))}
    </>
  );
}

export function FactLink({
  to,
  onFollow,
  children,
}: {
  to: LinkTarget;
  onFollow: (to: LinkTarget) => void;
  children: string;
}) {
  return (
    <DrawerLink title={linkTitle(to)} onClick={() => onFollow(to)}>
      {children}
    </DrawerLink>
  );
}

export function ObjectFacts({
  namespace,
  verdict,
  facts,
  created,
  onFollow,
}: {
  namespace: string;
  verdict: Verdict;
  facts: Fact[];
  created: string | undefined;
  onFollow: (to: LinkTarget) => void;
}) {
  return (
    <dl className="Prometheus-facts">
      <dt>Namespace</dt>
      <dd>{namespace}</dd>
      <dt>State</dt>
      <dd>
        <Status tone={verdict.tone} label={verdict.label} />
      </dd>
      <Facts facts={facts} onFollow={onFollow} />
      <dt>Created</dt>
      <dd>{created ?? "—"}</dd>
    </dl>
  );
}

export function AttentionFacts({ attention }: { attention: Verdict[] }) {
  return (
    <>
      {attention.map((item) => (
        <div key={item.reason} style={{ display: "contents" }}>
          <dt>{item.label}</dt>
          <dd className={`Prometheus-text--${item.tone}`}>{item.reason}</dd>
        </div>
      ))}
    </>
  );
}
