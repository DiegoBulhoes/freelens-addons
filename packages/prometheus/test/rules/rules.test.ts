import { describe, expect, it } from "vitest";
import {
  groupsOfRules,
  isRuleFilter,
  matchesRuleFilter,
  RULE_FILTERS,
  type RuleRow,
  ruleFileOwner,
  ruleReadNamespaces,
  ruleRows,
} from "../../src/renderer/api/rules/rules";
import { rejectionsFrom } from "../../src/renderer/api/shared/rejections";
import { selectorSources } from "../../src/renderer/api/shared/selection";
import type { RuleGroup } from "../../src/renderer/api/shared/types";
import {
  agents,
  collectors,
  events,
  named,
  prometheuses,
  prometheusRules,
  reads,
  ruleInventory,
  sources,
  variant,
} from "../support/fixtures";

const rowOf = (rows: RuleRow[], key: string) => {
  const found = rows.find((row) => row.key === key);

  if (!found) throw new Error(`no row ${key}`);

  return found;
};

describe("once the operator's Events expire", () => {
  it("broken-rule reads not loaded", () => {
    const row = rowOf(
      ruleRows(ruleInventory({ rejections: new Map() })),
      "PrometheusRule/prom-apps/broken-rule",
    );

    expect(row.state).toBe("not-loaded");
    expect(row.verdict.reason).toBe(
      "Prometheus monitoring/seed has not loaded it; its Events or logs say why",
    );
  });
});

describe("rule files", () => {
  it("name the Prometheus and the rule's uid, though both names hold hyphens", () => {
    const [group] = reads()[0]?.groups ?? [];

    expect(group && ruleFileOwner(group.file)).toEqual({
      prometheus: "seed",
      uid: "179a4943-b7f1-4e46-9779-17afb44323c6",
    });
    expect(ruleFileOwner("/etc/prometheus/rules/custom.yaml")).toBeUndefined();
  });
});

describe("each seeded rule", () => {
  const rows = () => ruleRows(ruleInventory());

  it("always-firing is loaded and firing", () => {
    const row = rowOf(rows(), "PrometheusRule/prom-apps/always-firing");

    expect(row.state).toBe("firing");
    expect(row.firing.map((alert) => alert.labels.alertname)).toEqual(["SeedAlwaysFiring"]);
    expect([row.groups, row.alerting, row.recording]).toEqual([1, 1, 0]);
    expect(row.verdict.reason).toBe("1 alert firing");
  });

  it("recording is loaded and healthy", () => {
    const row = rowOf(rows(), "PrometheusRule/prom-apps/recording");

    expect(row.state).toBe("healthy");
    expect(row.verdict.reason).toBe("Loaded by Prometheus monitoring/seed");
    expect(row.recording).toBe(1);
  });

  it("unselected-rule is not selected, excluded-rule sits outside, broken-rule was rejected", () => {
    expect(rowOf(rows(), "PrometheusRule/prom-apps/unselected-rule").state).toBe("not-selected");
    expect(rowOf(rows(), "PrometheusRule/prom-outside/excluded-rule").verdict.reason).toBe(
      "Prometheus monitoring/seed selects its labels, but not namespace prom-outside",
    );

    const broken = rowOf(rows(), "PrometheusRule/prom-apps/broken-rule");

    expect(broken.state).toBe("rejected");
    expect(broken.verdict.reason).toBe(
      "PrometheusRule broken-rule was rejected due to invalid configuration: invalid rule",
    );
  });

  it("pending-rule holds its alert pending", () => {
    const row = rowOf(rows(), "PrometheusRule/prom-apps/pending-rule");

    expect(row.state).toBe("pending");
    expect(row.pending.map((alert) => alert.labels.alertname)).toEqual(["SeedPending"]);
    expect(row.verdict).toEqual({ tone: "info", label: "Pending", reason: "1 alert pending" });
  });

  it("failing-rule fails each evaluation, with Prometheus's error", () => {
    const row = rowOf(rows(), "PrometheusRule/prom-apps/failing-rule");

    expect(row.state).toBe("unhealthy");
    expect(row.verdict.label).toBe("Evaluation failing");
    expect(row.verdict.reason).toMatch(
      /^1 rule failing: found duplicate series .*many-to-many matching not allowed/,
    );
  });
});

describe("live states made from variants", () => {
  const [seed] = reads();
  const withGroups = (change: (groups: RuleGroup[] | undefined) => RuleGroup[] | undefined) =>
    ruleRows(ruleInventory({ reads: seed ? [{ ...seed, groups: change(seed.groups) }] : [] }));

  it("selected but not in any rule file is not loaded", () => {
    const rows = withGroups((groups) => groups?.filter((group) => group.name !== "seed-recording"));

    expect(rowOf(rows, "PrometheusRule/prom-apps/recording").state).toBe("not-loaded");
  });

  it("a rule whose evaluation fails, and an alert still pending", () => {
    const rows = withGroups((groups) =>
      groups?.map((group) => ({
        ...group,
        rules: group.rules.map((rule) =>
          rule.type === "recording"
            ? { ...rule, health: "err", lastError: "many-to-many matching not allowed" }
            : { ...rule, alerts: rule.alerts?.map((alert) => ({ ...alert, state: "pending" })) },
        ),
      })),
    );

    expect(rowOf(rows, "PrometheusRule/prom-apps/recording").verdict.reason).toBe(
      "1 rule failing: many-to-many matching not allowed",
    );
    expect(rowOf(rows, "PrometheusRule/prom-apps/always-firing").state).toBe("pending");

    const silent = withGroups((groups) =>
      groups?.map((group) => ({
        ...group,
        rules: group.rules.map((rule) => ({ ...rule, health: "err", lastError: undefined })),
      })),
    );

    expect(rowOf(silent, "PrometheusRule/prom-apps/recording").verdict.reason).toBe(
      "1 rule failing",
    );
  });

  it("without its rules read, or with no read at all, it is unknown", () => {
    expect(
      rowOf(
        withGroups(() => undefined),
        "PrometheusRule/prom-apps/recording",
      ).verdict.reason,
    ).toBe("Its rules were not read");
    expect(
      rowOf(ruleRows(ruleInventory({ reads: [] })), "PrometheusRule/prom-apps/recording").verdict
        .reason,
    ).toBe("Prometheus monitoring/seed has not been read");
    expect(
      rowOf(
        ruleRows(
          ruleInventory({ reads: [{ source: "Prometheus/monitoring/seed", error: "503" }] }),
        ),
        "PrometheusRule/prom-apps/recording",
      ).verdict.reason,
    ).toBe("503");
  });

  it("a paused Prometheus is not asked, and a binding can refuse a rule", () => {
    const paused = prometheuses().map((each) =>
      variant(each, (data) => {
        data.spec.paused = true;
      }),
    );

    expect(
      rowOf(
        ruleRows(ruleInventory({ sources: selectorSources(paused, agents(), collectors()) })),
        "PrometheusRule/prom-apps/recording",
      ).verdict.reason,
    ).toBe("Prometheus monitoring/seed is paused");

    const refused = ruleInventory().rules.map((rule) =>
      variant(rule, (data) => {
        data.status = {
          bindings: [
            {
              resource: "prometheuses",
              name: "seed",
              namespace: "monitoring",
              conditions: [{ type: "Accepted", status: "False", reason: "InvalidConfiguration" }],
            },
          ],
        };
      }),
    );

    expect(
      rowOf(ruleRows(ruleInventory({ rules: refused })), "PrometheusRule/prom-apps/recording")
        .verdict.reason,
    ).toBe("Prometheus monitoring/seed: InvalidConfiguration");
  });

  it("a rule without groups, or a group without rules, counts nothing", () => {
    const hollow = ruleInventory().rules.map((rule) =>
      variant(rule, (data) => {
        for (const group of data.spec.groups ?? []) delete group.rules;
      }),
    );

    expect(
      rowOf(ruleRows(ruleInventory({ rules: hollow })), "PrometheusRule/prom-apps/recording")
        .groups,
    ).toBe(1);

    const empty = ruleInventory().rules.map((rule) =>
      variant(rule, (data) => {
        delete data.spec.groups;
      }),
    );
    const row = rowOf(
      ruleRows(ruleInventory({ rules: empty })),
      "PrometheusRule/prom-apps/recording",
    );

    expect([row.groups, row.alerting, row.recording]).toEqual([0, 0, 0]);
  });
});

describe("filters", () => {
  it("keep the states each chip names", () => {
    const rows = ruleRows(ruleInventory());

    expect(
      RULE_FILTERS.map((filter) => [
        filter,
        rows.filter((row) => matchesRuleFilter(row, filter)).length,
      ]),
    ).toEqual([
      ["attention", 5],
      ["firing", 2],
      ["not-loaded", 2],
      ["rejected", 2],
      ["healthy", 1],
      ["unknown", 0],
    ]);
    expect(rows.every((row) => matchesRuleFilter(row, undefined))).toBe(true);
    expect(isRuleFilter("firing")).toBe(true);
    expect(isRuleFilter("down")).toBe(false);
    expect(isRuleFilter(undefined)).toBe(false);
  });
});

describe("an InvalidConfiguration Event that no longer holds", () => {
  const [seed] = reads();
  const brokenOf = (change: Parameters<typeof ruleInventory>[0]) =>
    rowOf(ruleRows(ruleInventory(change)), "PrometheusRule/prom-apps/broken-rule");

  it("is about an earlier rule of the same name when its uid differs", () => {
    const recreated = events().map((event) => ({
      ...event,
      involvedObject: { ...event.involvedObject, uid: "00000000-0000-0000-0000-000000000000" },
    }));
    const row = brokenOf({ rejections: rejectionsFrom(recreated) });

    expect(row.rejection).toBeUndefined();
    expect(row.state).toBe("not-loaded");
  });

  it("is outrun by a group loaded from the rule: the fix was loaded", () => {
    // recording's real group, in the file the operator would write for broken-rule.
    const loaded = seed?.groups?.flatMap((group) =>
      group.name === "seed-recording"
        ? [
            group,
            {
              ...group,
              file: group.file.replace(
                /[0-9a-f-]{36}\.yaml$/,
                "2eafe779-1e5a-4fbd-bfcf-b606044f2dff.yaml",
              ),
            },
          ]
        : [group],
    );
    const row = brokenOf({ reads: seed ? [{ ...seed, groups: loaded }] : [] });

    expect(row.rejection).toBeUndefined();
    expect(row.state).toBe("healthy");
  });
});

describe("rule files, read once per answer", () => {
  it("group a read's loaded groups by their rule's uid", () => {
    const groups = reads()[0]?.groups ?? [];
    const byUid = groupsOfRules(groups);
    const owned = [...byUid].flatMap(([uid, each]) => each.map((group) => [uid, group] as const));

    expect(groupsOfRules(groups)).toBe(byUid);
    expect(byUid.get("179a4943-b7f1-4e46-9779-17afb44323c6")?.length).toBeGreaterThan(0);
    expect(owned).toHaveLength(groups.filter((group) => ruleFileOwner(group.file)).length);
    for (const [uid, group] of owned) expect(ruleFileOwner(group.file)?.uid).toBe(uid);

    const [first] = groups;
    const custom = first ? [{ ...first, file: "/etc/prometheus/rules/custom.yaml" }] : [];

    expect(groupsOfRules(custom).size).toBe(0);
  });

  it("give a rule without a uid no group", () => {
    const recording = named(prometheusRules(), "prom-apps/recording");
    const withoutUid = variant(recording, (data) => {
      delete data.metadata.uid;
    });

    const key = "PrometheusRule/prom-apps/recording";
    const withCustomFile = reads().map((read) => {
      const [first] = read.groups ?? [];

      return first
        ? {
            ...read,
            groups: [
              ...(read.groups ?? []),
              { ...first, file: "/etc/prometheus/rules/custom.yaml" },
            ],
          }
        : read;
    });
    const live = rowOf(
      ruleRows(ruleInventory({ rules: [withoutUid], reads: withCustomFile })),
      key,
    ).live;

    expect(rowOf(ruleRows(ruleInventory()), key).state).toBe("healthy");
    expect(live.length).toBeGreaterThan(0);
    for (const view of live) expect(view.groups).toEqual([]);
  });
});

describe("pods loaded for the Rules page", () => {
  it("only where a Prometheus that is read runs, not where agents or collectors do", () => {
    const noImage = variant(named(prometheuses(), "prom-broken/no-image"), (data) => {
      data.spec.paused = true;
    });

    const seed = named(prometheuses(), "monitoring/seed");

    expect(ruleReadNamespaces(sources())).toEqual(["monitoring", "prom-broken"]);
    expect(ruleReadNamespaces(selectorSources([seed, noImage], agents(), collectors()))).toEqual([
      "monitoring",
    ]);
  });
});
