import type { PodRow } from "./usage";

export function nodeChoices(names: (string | undefined)[]): string[] {
  return [...new Set(names.filter((name): name is string => Boolean(name)))].sort();
}

/** Nothing chosen keeps every name. */
export const keepChosen = (chosen: readonly string[]) => (name: string) =>
  chosen.length === 0 || chosen.includes(name);

export function podsOnNodes(rows: PodRow[], nodes: readonly string[]): PodRow[] {
  return rows.filter(
    (row) => nodes.length === 0 || (row.node !== undefined && nodes.includes(row.node)),
  );
}

/** A choice no longer offered drops out: a pod gone or on a node not chosen, a node gone. */
export function stillOffered(choices: readonly string[], chosen: readonly string[]): string[] {
  return chosen.filter((choice) => choices.includes(choice));
}

export function chosenPods(offered: PodRow[], chosen: readonly string[]): string[] {
  return stillOffered(
    offered.map((row) => row.key),
    chosen,
  );
}

export function filterPods(
  rows: PodRow[],
  nodes: readonly string[],
  pods: readonly string[],
): PodRow[] {
  const offered = podsOnNodes(rows, nodes);
  const picked = chosenPods(offered, pods);

  return picked.length === 0 ? offered : offered.filter((row) => picked.includes(row.key));
}

export function podChartTitle(measure: string, chosen: number, limit: number): string {
  if (chosen === 0) return `Top ${limit} by ${measure}`;
  if (chosen <= limit) return `${chosen} chosen by ${measure}`;

  return `Top ${limit} of ${chosen} chosen by ${measure}`;
}

export interface ChoiceNames {
  all: string;
  one: string;
  many: string;
}

export function describeChoice(chosen: readonly string[], names: ChoiceNames): string {
  if (chosen.length === 0) return names.all;

  const shown = chosen.slice(0, 2).join(", ");
  const more = chosen.length > 2 ? ` +${chosen.length - 2}` : "";

  return `${chosen.length === 1 ? names.one : names.many}: ${shown}${more}`;
}
