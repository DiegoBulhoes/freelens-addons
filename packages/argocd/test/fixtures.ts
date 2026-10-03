import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ingress, KubeEvent, Node, Pod } from "@freelensapp/kube-object";

import { AppProject } from "../src/renderer/api/app-project";
import { Application } from "../src/renderer/api/application";
import { ImageUpdater } from "../src/renderer/api/image-updater";

// Real cluster contents from `scripts/export-fixtures.sh`, built through the real `KubeObject` subclasses.

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

export function imageUpdaters(): ImageUpdater[] {
  return load("image-updaters", (item) => new ImageUpdater(item));
}

export function imageUpdater(name: string): ImageUpdater {
  const found = imageUpdaters().find((candidate) => candidate.getName() === name);

  if (!found) throw new Error(`no ImageUpdater named ${name} in the fixtures`);

  return found;
}

export function nodes(): Node[] {
  return load("nodes", (item) => new Node(item));
}

export function events(): KubeEvent[] {
  return load("events", (item) => new KubeEvent(item));
}

/** The newest fixture timestamp, so time-dependent tests do not decay as the real clock moves. */
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

export function application(name: string): Application {
  const found = applications().find((candidate) => candidate.getName() === name);

  if (!found) throw new Error(`no Application named ${name} in the fixtures`);

  return found;
}

export interface MutableApplication {
  metadata: Record<string, unknown>;
  spec: Record<string, unknown>;
  status?: Record<string, unknown>;
}

export function statusOf(data: MutableApplication): Record<string, unknown> {
  data.status ??= {};

  return data.status;
}

/** A real Application with one change applied, so it stays valid everywhere else. */
export function variantOf(name: string, change: (data: MutableApplication) => void): Application {
  const source = application(name);
  const data = JSON.parse(JSON.stringify(source.toPlainObject())) as MutableApplication;

  change(data);

  return new Application(data as never);
}

export { Ingress, KubeEvent, Node, Pod };
