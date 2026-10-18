import type { Application } from "../api/applications/application";
import { firstFew } from "../api/shared/table";
import { DrawerLink } from "../components/drawer-link";

const MAX_NAMES_SHOWN = 3;

export function ApplicationNames({
  applications,
  onOpen,
}: {
  applications: Application[];
  onOpen: (application: Application) => void;
}) {
  const { shown, more } = firstFew(applications, MAX_NAMES_SHOWN);

  return (
    <>
      {shown.map((application, index) => (
        <span key={`${application.getNs()}/${application.getName()}`}>
          {index > 0 && <span className="ArgoCD-muted">, </span>}
          <DrawerLink
            label={application.getName()}
            title="Opens it in the Applications list, with its details"
            onOpen={() => onOpen(application)}
          />
        </span>
      ))}
      {more > 0 && <span className="ArgoCD-muted"> +{more}</span>}
    </>
  );
}
