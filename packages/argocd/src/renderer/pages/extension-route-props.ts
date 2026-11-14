import type { Renderer } from "@freelensapp/extensions";

import type { RouteProps } from "../hooks/route-params";

export type ExtensionRouteProps = RouteProps & { extension: Renderer.LensExtension };
