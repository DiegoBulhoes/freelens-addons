import {
  type CertificateFilter,
  endsWithinLabel,
  FILTER_LABELS,
  matchesFilter,
} from "../certificates/certificate-filter";
import { ALARM_DAYS, EXPIRING_DAYS, expiresWithin } from "../certificates/expiry";
import type { CertificateLike } from "../shared/types";

export interface CertificateCard {
  key: string;
  value: number;
  label: string;
  tone?: "critical" | "warning";
  title?: string;
  /** The certificates page's chip this card opens; none for a card that does not open. */
  filter?: CertificateFilter;
}

const FILTER_CARDS: { filter: CertificateFilter; tone?: "critical" | "warning"; title: string }[] =
  [
    { filter: "all", title: "Opens every certificate in the certificates page" },
    {
      filter: "not-ready",
      tone: "critical",
      title: "Opens the certificates with nothing ready to serve",
    },
    {
      filter: "out-of-date",
      tone: "warning",
      title:
        "Opens the certificates still serving a previous certificate while a new one is not ready",
    },
    {
      filter: "failing",
      tone: "warning",
      title: "Opens the certificates whose renewal is failing",
    },
  ];

/** Each card counts what its chip lists, under the chip's own name; none without the list. */
export function certificateCards(
  certificates: CertificateLike[],
  now: number,
  listed: boolean,
): CertificateCard[] {
  if (!listed) return [];

  const counted = (filter: CertificateFilter) =>
    certificates.filter((each) => matchesFilter(each, filter, now)).length;
  const fromFilter = ({ filter, tone, title }: (typeof FILTER_CARDS)[number]): CertificateCard => ({
    key: filter,
    value: counted(filter),
    label: filter === "all" ? "Certificates" : FILTER_LABELS[filter],
    tone,
    title,
    filter,
  });

  return [
    ...FILTER_CARDS.map(fromFilter),
    // Not pressable: the chip's window is the month, which this card does not count.
    {
      key: "alarm",
      value: certificates.filter((each) => expiresWithin(each, now, ALARM_DAYS)).length,
      label: endsWithinLabel(ALARM_DAYS),
      tone: "warning",
    },
    fromFilter({
      filter: "expiring",
      title: `Opens the certificates that end within ${EXPIRING_DAYS} days`,
    }),
  ];
}
