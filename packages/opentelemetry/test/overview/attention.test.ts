import { describe, expect, it } from "vitest";
import {
  type CollectorRow,
  collectorRows,
  collectorSearchTexts,
} from "../../src/renderer/api/collectors/collectors";
import {
  coverageRows,
  coverageSearchTexts,
  FILTER_TITLES,
  matchesFilter,
} from "../../src/renderer/api/coverage/coverage";
import {
  attentionOf,
  COLLECTORS_CARD_TITLE,
  cardsOf,
  describeHeadline,
  namedKey,
} from "../../src/renderer/api/overview/attention";
import { searchRows } from "../../src/renderer/api/shared/table";
import { collectors, coverageInventory, NOW, pods } from "../support/fixtures";

const coverage = () => coverageRows(coverageInventory());
const collected = () => collectorRows(collectors(), pods(), new Map(), NOW);

describe("needs attention", () => {
  it("lists the critical rows of both pages first, then the warnings, and no choice", () => {
    expect(attentionOf(coverage(), collected()).map((item) => [item.page, item.name])).toEqual([
      ["coverage", "typo"],
      ["coverage", "migrate"],
      ["coverage", "orphan"],
      ["coverage", "ambiguous"],
      ["coverage", "misplaced"],
      ["coverage", "go-service"],
      ["coverage", "polyglot"],
      ["coverage", "secure"],
      ["collectors", "broken"],
      ["coverage", "late"],
      ["coverage", "late-agent"],
      ["collectors", "allocator"],
    ]);
  });

  it("says what each item is and where", () => {
    const items = attentionOf(coverage(), collected());

    expect(items.find((item) => item.name === "late-agent")?.meta).toBe("DaemonSet · otel-late");
    expect(items.find((item) => item.name === "broken")).toMatchObject({
      key: "collectors/otel-collectors/broken",
      meta: "OpenTelemetryCollector · otel-collectors",
    });
  });
});

describe("opening an attention row", () => {
  it("names the one row whose drawer opens, never another of the same name", () => {
    const rows = coverage();
    const list = collected();
    const keysOf = (page: "coverage" | "collectors") =>
      page === "coverage" ? rows.map((row) => row.key) : list.map((row) => row.key);

    for (const item of attentionOf(rows, list)) {
      const key = namedKey(item.page, item.opens);

      expect(`${item.page}/${key}`).toBe(item.key);
      expect(keysOf(item.page).filter((each) => each === key)).toHaveLength(1);
    }
    expect(attentionOf(rows, list).find((item) => item.name === "late")?.opens).toEqual({
      kind: "Deployment",
      namespace: "otel-late",
      name: "late",
    });
  });

  it("opens no drawer when the route names nothing", () => {
    expect(namedKey("coverage", {})).toBeUndefined();
    expect(namedKey("collectors", { namespace: "otel-collectors", name: "" })).toBeUndefined();
    expect(namedKey("coverage", { name: "late" })).toBe("//late");
    expect(namedKey("collectors", { name: "broken" })).toBe("/broken");
  });

  it("finds a row by namespace/name in the search, apart from its namesakes' namespaces", () => {
    const shown = (query: string) =>
      searchRows(coverage(), query, coverageSearchTexts).map((row) => row.key);

    expect(shown("otel-orphan/orphan")).toEqual(["Deployment/otel-orphan/orphan"]);
    expect(shown("otel-orphan")).toContain("Deployment/otel-orphan/cross-ns");
    expect(
      searchRows(collected(), "otel-collectors/broken", collectorSearchTexts).map((row) => row.key),
    ).toEqual(["otel-collectors/broken"]);
  });
});

describe("the headline", () => {
  const rows = coverage();
  const broken = collected().find((row) => row.name === "broken");
  const gateway = collected().find((row) => row.name === "gateway");
  const injected = rows.filter((row) => row.state === "injected");

  it("counts workloads and collectors needing attention, each of its own total", () => {
    expect(describeHeadline(rows, collected())).toBe(
      "10 of 16 workloads and 2 of 5 collectors need attention",
    );
    expect(
      describeHeadline(
        rows.filter((row) => row.name === "late"),
        [],
      ),
    ).toBe("1 of 1 workload needs attention");
    expect(
      describeHeadline(
        injected,
        [broken, gateway].flatMap((row) => row ?? []),
      ),
    ).toBe("1 of 2 collectors needs attention");
  });

  it("says it is still checking rather than all injected while a row reads Checking", () => {
    const unread = coverageRows({ ...coverageInventory(), operator: undefined }).filter(
      (row) => row.name === "late" || row.state === "injected",
    );

    expect(unread.map((row) => row.state)).toContain("pending");
    expect(describeHeadline(unread, [])).toBe(`Checking ${unread.length} instrumented workloads`);
  });

  it("says all is injected, or that nothing opts in", () => {
    expect(describeHeadline(injected, gateway ? [gateway] : [])).toBe(
      "6 instrumented workloads, all injected",
    );
    expect(
      describeHeadline(
        rows.filter((row) => row.state === "opted-out"),
        [],
      ),
    ).toBe("No workload opts in to auto-instrumentation");
    expect(describeHeadline([], [])).toBe("No workload opts in to auto-instrumentation");
  });
});

describe("the Overview cards", () => {
  it("count the rows a Coverage card's filter keeps, and the not-ready collectors atop their list", () => {
    const rows = coverage();
    const list = collected();
    const cards = cardsOf(rows, list, true);
    const pressing = (tone: string) => tone === "critical" || tone === "warning";

    for (const card of cards) {
      const opens = card.opens;

      if (opens.page === "coverage") {
        expect(card.value).toBe(rows.filter((row) => matchesFilter(row, opens.filter)).length);
      } else {
        expect(list.slice(0, card.value).every((row) => pressing(row.verdict.tone))).toBe(true);
        expect(list.slice(card.value).some((row) => pressing(row.verdict.tone))).toBe(false);
      }
    }
    expect(cards.map((card) => [card.label, card.value])).toEqual([
      ["Restart needed", 2],
      ["Not injected", 8],
      ["Injected", 6],
      ["Opted out", 1],
      ["Collectors not ready", 2],
    ]);
  });

  it("each card's tooltip says what the list it opens shows, as that list's chip does", () => {
    const titles = Object.fromEntries(
      cardsOf(coverage(), collected(), true).map((card) => [card.label, card.title]),
    );

    expect(titles["Restart needed"]).toBe(
      FILTER_TITLES["restart-needed"].replace("Shows ", "Opens "),
    );
    expect(titles["Collectors not ready"]).toBe(COLLECTORS_CARD_TITLE);
    expect(Object.values(titles).every((title) => /^Opens /.test(title))).toBe(true);
    expect(new Set(Object.values(titles)).size).toBe(Object.keys(titles).length);
  });

  it("count a collector whose own pods are ready but whose target allocator is not", () => {
    const allocator = collected().find((row) => row.key === "otel-allocator/allocator");

    expect(allocator?.replicas).toEqual({ ready: 1, desired: 1 });
    const notReady = (rows: CollectorRow[]) =>
      cardsOf(coverage(), rows, true).find((card) => card.label === "Collectors not ready")?.value;

    expect(notReady(collected())).toBe(2);
    expect(notReady(collected().filter((row) => row.key !== allocator?.key))).toBe(1);
  });

  it("show no count of collectors not ready until the collectors are read", () => {
    const cards = cardsOf(coverage(), collected(), false);

    expect(cards.find((card) => card.label === "Collectors not ready")?.value).toBeUndefined();
    expect(cards.find((card) => card.label === "Not injected")?.value).toBe(8);
  });
});
