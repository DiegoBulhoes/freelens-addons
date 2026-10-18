import { describe, expect, it } from "vitest";

import {
  endsWithinLabel,
  FILTER_LABELS,
  selectCertificates,
} from "../../src/renderer/api/certificates/certificate-filter";
import {
  ALARM_DAYS,
  EXPIRING_DAYS,
  expiresWithin,
} from "../../src/renderer/api/certificates/expiry";
import { certificateCards } from "../../src/renderer/api/overview/overview";
import { certificates, fixtureNow } from "../support/fixtures";

const now = fixtureNow();
const cards = certificateCards(certificates(), now, true);

describe("the overview's certificate cards", () => {
  it("counts on each card that opens a chip exactly what that chip lists", () => {
    const opening = cards.filter((card) => card.filter);

    expect(opening.map((card) => card.filter)).toEqual([
      "all",
      "not-ready",
      "out-of-date",
      "failing",
      "expiring",
    ]);
    for (const card of opening) {
      const filter = card.filter ?? "all";

      expect(card.value, card.label).toBe(
        selectCertificates(certificates(), filter, "", now).length,
      );
    }
  });

  it("names each card as its chip is named", () => {
    for (const card of cards) {
      if (card.filter && card.filter !== "all") expect(card.label).toBe(FILTER_LABELS[card.filter]);
    }
    expect(cards.find((card) => card.filter === "all")?.label).toBe("Certificates");
  });

  it("words both windows the same way, the chip's", () => {
    expect(FILTER_LABELS.expiring).toBe(endsWithinLabel(EXPIRING_DAYS));
    expect(cards.map((card) => card.label)).toEqual(
      expect.arrayContaining([
        `Ends within ${ALARM_DAYS} days`,
        `Ends within ${EXPIRING_DAYS} days`,
      ]),
    );
  });

  it("does not open a chip from the week card, whose window no chip has", () => {
    const week = cards.find((card) => card.label === endsWithinLabel(ALARM_DAYS));

    expect(week?.filter).toBeUndefined();
    expect(week?.value).toBe(
      certificates().filter((each) => expiresWithin(each, now, ALARM_DAYS)).length,
    );
    expect(week?.value).toBeGreaterThan(0);
  });
});

describe("the overview's certificate cards without the list", () => {
  it("count nothing when the Certificate list was refused", () => {
    expect(certificateCards(certificates(), now, false)).toEqual([]);
  });
});
