import type { Common } from "@freelensapp/extensions";

export type RouteProps = Common.Types.PageComponentProps;

/** A route param as text; `get()` is untyped and a param the link left out is absent. */
export function paramText(params: RouteProps["params"], name: string): string {
  const value: unknown = params[name]?.get();
  return typeof value === "string" ? value : "";
}
