import { useEffect, useState } from "react";
import { settleInSlots, withTimeout } from "../api/shared/read-timeout";
import { hasGivenUp, nextListDelay } from "../api/shared/retry";
import {
  METADATA_ONLY,
  mergeSbomListings,
  type PartialObjectMetadataList,
  refusedIn,
  type SbomListings,
  type SbomSubject,
  sbomListPath,
  sbomSubjectsIn,
  settledSbomListings,
} from "../api/workloads/sbom-metadata";

const API_PROXY = "/api-kube";

export interface SbomSubjects {
  subjects: SbomSubject[];
  /** The scope the latest listing completed for; undefined until one has. */
  loadedFor?: string;
  refusedIn: string[];
  gaveUp: boolean;
}

async function listSbomMetadata(namespace: string): Promise<PartialObjectMetadataList> {
  const response = await withTimeout((signal) =>
    fetch(`${API_PROXY}${sbomListPath(namespace)}`, { headers: { Accept: METADATA_ONLY }, signal }),
  );

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

  return (await response.json()) as PartialObjectMetadataList;
}

// Listed again on a timer rather than watched: a watch would stream every rescanned SBOM's body.
export function useSbomSubjects(registered: boolean, scope: string): SbomSubjects {
  const [listings, setListings] = useState<SbomListings>(new Map());
  const [loadedFor, setLoadedFor] = useState<string>();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!registered) return;

    const namespaces = scope ? scope.split(",") : [];
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setGaveUp(false);

    const list = async () => {
      const results = await settleInSlots(namespaces, listSbomMetadata);

      if (cancelled) return;

      const listed = settledSbomListings(namespaces, results);

      setListings((before) => mergeSbomListings(before, listed));
      setLoadedFor(scope);
      failures = refusedIn(listed, namespaces).length > 0 ? failures + 1 : 0;
      setGaveUp(hasGivenUp(failures));
      timer = setTimeout(() => void list(), nextListDelay(failures));
    };

    void list();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [registered, scope]);

  const namespaces = scope ? scope.split(",") : [];

  return {
    subjects: sbomSubjectsIn(listings, namespaces),
    loadedFor,
    refusedIn: refusedIn(listings, namespaces),
    gaveUp,
  };
}
