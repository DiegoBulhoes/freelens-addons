import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ingress, KubeEvent, Node, Pod } from "@freelensapp/kube-object";

import { AppProject } from "../src/renderer/api/app-project";
import { Application } from "../src/renderer/api/application";

/**
 * The cluster, as it actually was.
 *
 * These are 52 Applications, an AppProject, a Node and its warning events,
 * exported by `scripts/export-fixtures.sh` from a running ArgoCD and stripped
 * of machine identifiers. Nothing here was written to agree with the code, and
 * that is the point: hand-written fixtures contain the fields their author
 * remembered, which is why they never catch the Application whose source is
 * spelled `sources`, the one with no `status` yet, or the history entry that
 * carries `revisions` instead of `revision`. All three of those were real bugs
 * in this extension.
 *
 * Objects are constructed through the real `KubeObject` subclasses, so a
 * fixture that the running application would reject fails here too.
 */

function load<T>(name: string, build: (item: never) => T): T[] {
  const path = resolve(__dirname, "fixtures", `${name}.json`);
  const document = JSON.parse(readFileSync(path, "utf8")) as { items: never[] };

  return document.items.map(build);
}

export function applications(): Application[] {
  return load("applications", (item) => new Application(item));
}

export function appProjects(): AppProject[] {
  return load("app-projects", (item) => new AppProject(item));
}

export function nodes(): Node[] {
  return load("nodes", (item) => new Node(item));
}

export function events(): KubeEvent[] {
  return load("events", (item) => new KubeEvent(item));
}

/**
 * The moment the fixtures were taken, derived from the data itself.
 *
 * Anything that asks "is this stale" needs a `now` to compare against. Reading
 * the real clock would mean every such test passes today and fails tomorrow,
 * as the recorded timestamps recede; anchoring to the newest timestamp in the
 * fixtures makes "recently" mean what it meant when the cluster was in this
 * state, permanently.
 */
export function fixtureNow(): number {
  let newest = 0;

  for (const application of applications()) {
    for (const stamp of [
      application.status?.reconciledAt,
      application.status?.operationState?.finishedAt,
      ...(application.status?.history ?? []).map((record) => record.deployedAt),
    ]) {
      const parsed = stamp ? Date.parse(stamp) : Number.NaN;

      if (!Number.isNaN(parsed) && parsed > newest) newest = parsed;
    }
  }

  return newest;
}

/** The one Application with a given name, or a failure that says which is missing. */
export function application(name: string): Application {
  const found = applications().find((candidate) => candidate.getName() === name);

  if (!found) throw new Error(`no Application named ${name} in the fixtures`);

  return found;
}

/** An Application as plain JSON, loose enough for a test to change one field. */
export interface MutableApplication {
  metadata: Record<string, unknown>;
  spec: Record<string, unknown>;
  status?: Record<string, unknown>;
}

/** `data.status`, created if the variation is adding one. */
export function statusOf(data: MutableApplication): Record<string, unknown> {
  data.status ??= {};

  return data.status;
}

/**
 * A variation on a real Application.
 *
 * Every field starts as the cluster reported it and the test changes only what
 * it is about, so a case for "no status yet" is still an object the application
 * would accept everywhere else.
 */
export function variantOf(name: string, change: (data: MutableApplication) => void): Application {
  const source = application(name);
  const data = JSON.parse(JSON.stringify(source.toPlainObject())) as MutableApplication;

  change(data);

  return new Application(data as never);
}

export { Ingress, KubeEvent, Node, Pod };
