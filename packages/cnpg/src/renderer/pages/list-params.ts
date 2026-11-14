import type { OpenPage } from "../api/shared/navigation";
import type { RouteProps } from "../hooks/route-params";

/** A list page's props: the route params LIST_PARAMS in index.tsx declares, and a way to open another page. */
export type ListPageRouteProps = RouteProps & { open: OpenPage };
