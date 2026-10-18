import { describeAge, formatTime } from "../api/shared/time";
import { END_OF_LIFE, type ScannedContainer } from "../api/workloads/workload-report";

const SHORT_DIGEST = 19;

export function ContainerDetails({
  containers,
  now,
}: {
  containers: ScannedContainer[];
  now: number;
}) {
  if (containers.length === 0) return null;

  return (
    <section className="Trivy-section" data-section="trivy-workload-containers">
      <h3 className="Trivy-section__title">
        {containers.length === 1 ? "Container" : `${containers.length} containers`}
      </h3>

      <div className="Trivy-list">
        {containers.map((container, index) => (
          <dl className="Trivy-facts" key={container.name ?? `container-${index}`}>
            {container.name && (
              <>
                <dt>Container</dt>
                <dd>
                  <code>{container.name}</code>
                </dd>
              </>
            )}
            {container.image && (
              <>
                <dt>Image</dt>
                <dd>
                  <code>{container.image}</code>
                </dd>
              </>
            )}
            {container.registry && (
              <>
                <dt>Registry</dt>
                <dd>{container.registry}</dd>
              </>
            )}
            {container.digest && (
              <>
                <dt>Digest</dt>
                <dd>
                  <code title={container.digest}>{container.digest.slice(0, SHORT_DIGEST)}…</code>
                </dd>
              </>
            )}
            {container.operatingSystem && (
              <>
                <dt>Base</dt>
                <dd>
                  {container.operatingSystem}
                  {container.endOfLife && (
                    <span className="Trivy-text--warning">, {END_OF_LIFE}</span>
                  )}
                </dd>
              </>
            )}
            {container.scannedAt && (
              <>
                <dt>Scanned</dt>
                <dd title={describeAge(container.scannedAt, now)}>
                  {formatTime(container.scannedAt)}
                </dd>
              </>
            )}
            {container.scanner && (
              <>
                <dt>Scanner</dt>
                <dd>{container.scanner}</dd>
              </>
            )}
          </dl>
        ))}
      </div>
    </section>
  );
}
