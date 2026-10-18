import { observer } from "mobx-react";
import type { CoverageRow } from "../api/coverage/coverage";
import type { Exporter } from "../api/coverage/exporter";
import {
  describeContainers,
  describeExporter,
  exporterLink,
  instrumentationFacts,
  languageFacts,
} from "../api/coverage/facts";
import type { OperatorList } from "../api/coverage/operator";
import { keyOf } from "../api/coverage/resolve";
import { hostListOf, LIST_NAMES } from "../api/shared/host-links";
import type { InstrumentationLike } from "../api/shared/types";
import { openHostList } from "../api/writes/actions";
import { COPY_ANNOTATION_TOOLTIP, commandsOf, RESTART_TOOLTIP } from "../api/writes/operations";
import { CommandsSection } from "../components/commands-section";
import { DrawerLink } from "../components/drawer-link";
import { Facts } from "../components/facts";
import { ObjectDrawer } from "../components/object-drawer";
import { Status } from "../components/status";
import type { OpenPage } from "../pages/overview-page";
import { confirmRestart, copyAnnotation } from "./dialogs";
import { PodsSection } from "./pods-section";

interface CoverageDrawerProps {
  row?: CoverageRow;
  exporter?: Exporter;
  operator?: OperatorList;
  instrumentations?: InstrumentationLike[];
  open?: OpenPage;
  onClose: () => void;
}

export const CoverageDrawer = observer(
  ({ row, exporter, operator, instrumentations, open, onClose }: CoverageDrawerProps) => {
    const exportsTo = exporter && describeExporter(exporter);
    const exportLink = exporter && exporterLink(exporter);
    const leave = (go: () => void) => {
      onClose();
      go();
    };

    return (
      <ObjectDrawer
        open={Boolean(row)}
        kind={row?.kind ?? "Workload"}
        name={row?.name ?? ""}
        onClose={onClose}
        state={row?.verdict}
        section="opentelemetry-workload"
        actions={
          row
            ? [
                {
                  icon: "content_copy",
                  title: COPY_ANNOTATION_TOOLTIP,
                  onClick: () => void copyAnnotation(row, instrumentations),
                },
                {
                  icon: "restart_alt",
                  title: RESTART_TOOLTIP,
                  onClick: () => confirmRestart(row),
                },
              ]
            : []
        }
      >
        {row && (
          <>
            <dl className="OpenTelemetry-facts">
              <dt>Namespace</dt>
              <dd>{row.namespace}</dd>
              <dt>State</dt>
              <dd>
                <Status tone={row.verdict.tone} label={row.verdict.label} />
              </dd>
              {row.languages.map((language) => (
                <div key={language.optIn.language} style={{ display: "contents" }}>
                  <Facts facts={languageFacts(row, language)} mono="Annotation" />
                </div>
              ))}
              <dt>Container</dt>
              <dd>{describeContainers(row)}</dd>
              {row.instrumentation && (
                <Facts facts={instrumentationFacts(row.instrumentation)} mono="Endpoint" />
              )}
              {exportsTo && (
                <>
                  <dt>Exports to</dt>
                  <dd>
                    {exportLink && open ? (
                      <DrawerLink
                        title={exportLink.title}
                        onClick={() =>
                          leave(() =>
                            open("collectors", {
                              namespace: exportLink.namespace,
                              name: exportLink.name,
                            }),
                          )
                        }
                      >
                        {exportsTo.value}
                      </DrawerLink>
                    ) : (
                      exportsTo.value
                    )}
                    {exportsTo.warning && (
                      <div className="OpenTelemetry-text--warning">{exportsTo.warning}</div>
                    )}
                  </dd>
                </>
              )}
              <dt>Host list</dt>
              <dd>
                <div>
                  <DrawerLink
                    title={`Opens the ${LIST_NAMES[row.kind]} list narrowed to ${row.name}`}
                    onClick={() => leave(() => openHostList(hostListOf(row.kind, row.name)))}
                  >
                    {`${row.name} in the ${LIST_NAMES[row.kind]} list`}
                  </DrawerLink>
                </div>
                {row.instrumentation && (
                  <div>
                    <DrawerLink
                      title={`Opens the Instrumentations list narrowed to ${keyOf(row.instrumentation)}`}
                      onClick={() =>
                        leave(() =>
                          openHostList(
                            hostListOf("Instrumentation", row.instrumentation?.getName() ?? ""),
                          ),
                        )
                      }
                    >
                      {`${row.instrumentation.getName()} in the Instrumentations list`}
                    </DrawerLink>
                  </div>
                )}
              </dd>
              <dt>Created</dt>
              <dd>{row.workload.metadata.creationTimestamp ?? "—"}</dd>
            </dl>

            <PodsSection row={row} onLeave={onClose} />

            <CommandsSection
              commands={commandsOf(row, operator)}
              section="opentelemetry-workload-commands"
            />
          </>
        )}
      </ObjectDrawer>
    );
  },
);
