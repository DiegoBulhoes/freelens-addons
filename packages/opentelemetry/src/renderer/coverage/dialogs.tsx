import { Renderer } from "@freelensapp/extensions";
import type { CoverageRow } from "../api/coverage/coverage";
import type { InstrumentationLike } from "../api/shared/types";
import { restartWorkload } from "../api/writes/actions";
import { annotationYaml, restartDetail, restartRefusal } from "../api/writes/operations";
import { confirmWrite, notifyDone } from "../components/confirm";

const {
  Component: { Notifications },
} = Renderer;

export function confirmRestart(row: CoverageRow): void {
  const refused = restartRefusal(row);

  if (refused) {
    Notifications.error(`${row.name} was not restarted: ${refused}`);
    return;
  }

  const target = `${row.namespace}/${row.name}`;

  confirmWrite({
    question: (
      <>
        Restart <b>{row.name}</b>?
      </>
    ),
    detail: restartDetail(row),
    label: "Restart",
    destructive: true,
    typed: () => row.name,
    ok: async () => {
      try {
        await restartWorkload(row);
        notifyDone(`Restart of ${target} requested.`);
      } catch (error) {
        Notifications.checkedError(error, `Could not restart ${target}`);
      }
    },
  });
}

export async function copyAnnotation(
  row: CoverageRow,
  instrumentations: InstrumentationLike[] | undefined,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(annotationYaml(row, instrumentations ?? []));
    Notifications.ok("Annotation YAML copied.");
  } catch (error) {
    Notifications.checkedError(error, "Could not copy the annotation");
  }
}
