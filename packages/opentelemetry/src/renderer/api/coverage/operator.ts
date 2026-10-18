import type { EnvName, WorkloadLike } from "../shared/types";
import { LANGUAGES, type Language } from "./annotations";
import type { Blocker } from "./blockers";
import { keyOf } from "./resolve";

export const OPERATOR_SELECTOR = "app.kubernetes.io/name=opentelemetry-operator";
const MANAGER = "manager";

export interface OperatorContainer {
  name: string;
  command?: string[];
  args?: string[];
  env?: (EnvName & { value?: string })[];
  envFrom?: unknown[];
}

/** A Deployment as the API lists it: plain JSON, only what the switches are read from. */
export interface OperatorDeployment {
  metadata: { name?: string; namespace?: string };
  spec?: { template?: { spec?: { containers?: OperatorContainer[] } } };
}

/** The operator's Deployments, cluster-wide; `error` when the list was refused. */
export type OperatorList = { items: OperatorDeployment[] } | { error: string };

export interface LanguageSetting {
  kind: "on" | "off" | "unknown" | "pending";
  why: string;
}

interface Switch {
  flag: string;
  env: string;
  byDefault: boolean;
}

const switchFor = (name: string, byDefault: boolean): Switch => ({
  flag: `--enable-${name}-instrumentation`,
  env: `ENABLE_${name.toUpperCase().replace(/-/g, "_")}_AUTO_INSTRUMENTATION`,
  byDefault,
});

// internal/config cli.go, env.go and config.go New() at v0.158.0; the SDK has no switch.
const SWITCHES: Partial<Record<Language, Switch>> = {
  java: switchFor("java", true),
  nodejs: switchFor("nodejs", true),
  python: switchFor("python", true),
  dotnet: switchFor("dotnet", true),
  go: switchFor("go", false),
  "apache-httpd": switchFor("apache-httpd", true),
  nginx: switchFor("nginx", false),
};

/** Go's strconv.ParseBool, which both pflag and the env reader use. */
function parseBool(value: string): boolean | undefined {
  if (["1", "t", "T", "TRUE", "true", "True"].includes(value)) return true;
  if (["0", "f", "F", "FALSE", "false", "False"].includes(value)) return false;

  return undefined;
}

const onOff = (on: boolean) => (on ? "on" : "off");

/** The last `--name` or `--name=value` before a `--`, as pflag reads os.Args[1:]. */
function flagValue(tokens: string[], name: string): string | undefined {
  const end = tokens.indexOf("--");
  let found: string | undefined;

  for (const token of end < 0 ? tokens : tokens.slice(0, end)) {
    if (token === name) found = "true";
    else if (token.startsWith(`${name}=`)) found = token.slice(name.length + 1);
  }

  return found;
}

/** The container the switches and the webhook's log are read from. */
export function managerOf(deployment: OperatorDeployment): OperatorContainer | undefined {
  const containers = deployment.spec?.template?.spec?.containers ?? [];

  return containers.find((each) => each.name === MANAGER) ?? containers[0];
}

/** Flags beat env, env beats the config file, the file beats the default (config.go Apply). */
function settingOf(deployment: OperatorDeployment, languageSwitch: Switch): LanguageSetting {
  const container = managerOf(deployment);

  if (!container) return { kind: "unknown", why: "its Deployment has no container" };

  const tokens = [...(container.command ?? []).slice(1), ...(container.args ?? [])];
  const flag = flagValue(tokens, languageSwitch.flag);

  if (flag !== undefined) {
    const on = parseBool(flag);

    return on === undefined
      ? {
          kind: "unknown",
          why: `its args set ${languageSwitch.flag}=${flag}, which is not a boolean`,
        }
      : { kind: onOff(on), why: `its args set ${languageSwitch.flag}=${flag}` };
  }

  const env = (container.env ?? []).filter((each) => each.name === languageSwitch.env).at(-1);

  if (env?.valueFrom) {
    return { kind: "unknown", why: `its ${languageSwitch.env} comes from valueFrom` };
  }
  if (env) {
    const value = env.value ?? "";
    const on = parseBool(value);

    // env.go drops the parse error: anything but a boolean turns the language off.
    return on === undefined
      ? { kind: "off", why: `its ${languageSwitch.env} is "${value}", which it reads as false` }
      : { kind: onOff(on), why: `its ${languageSwitch.env} is "${value}"` };
  }
  if (container.envFrom?.length) {
    return { kind: "unknown", why: `its envFrom may set ${languageSwitch.env}` };
  }
  if (flagValue(tokens, "--config-file") !== undefined) {
    return { kind: "unknown", why: `its --config-file may set ${languageSwitch.flag}` };
  }

  return {
    kind: onOff(languageSwitch.byDefault),
    why: `${languageSwitch.flag} is ${onOff(languageSwitch.byDefault)} by default`,
  };
}

/** The operator's Deployments the scoped stores hold, with their versions: a change re-reads the list. */
export function operatorVersions(workloads: WorkloadLike[]): string {
  const [label, value] = OPERATOR_SELECTOR.split("=") as [string, string];

  return workloads
    .filter((each) => each.kind === "Deployment" && each.metadata.labels?.[label] === value)
    .map((each) => `${keyOf(each)}@${each.metadata.resourceVersion ?? ""}`)
    .sort()
    .join(",");
}

/** Whether the operator injects a language; undefined `list` means not read yet. */
export function languageSetting(
  list: OperatorList | undefined,
  language: Language,
): LanguageSetting {
  const languageSwitch = SWITCHES[language];

  if (!languageSwitch) return { kind: "on", why: "no flag turns it off" };
  if (!list) return { kind: "pending", why: "the operator's Deployment is not read yet" };
  if ("error" in list) {
    return {
      kind: "unknown",
      why: `the operator's Deployment could not be listed (${list.error})`,
    };
  }
  if (list.items.length === 0) {
    return { kind: "unknown", why: `no Deployment carries ${OPERATOR_SELECTOR}` };
  }

  const settings = list.items.map((deployment) => settingOf(deployment, languageSwitch));
  const first = settings[0] as LanguageSetting;

  if (settings.some((each) => each.kind !== first.kind)) {
    return {
      kind: "unknown",
      why: `the ${settings.length} Deployments carrying ${OPERATOR_SELECTOR} disagree on ${languageSwitch.flag}`,
    };
  }

  return first;
}

/** One certain blocker per language the operator does not inject, one uncertain per reason it could not be read. */
export function operatorBlockers(settings: Map<Language, LanguageSetting>): Blocker[] {
  const off = [...settings].filter(([, setting]) => setting.kind === "off");
  const doubts = new Map<string, { pending: boolean; labels: string[] }>();

  for (const [language, setting] of settings) {
    if (setting.kind === "unknown" || setting.kind === "pending") {
      const doubt = doubts.get(setting.why) ?? { pending: setting.kind === "pending", labels: [] };

      doubts.set(setting.why, { ...doubt, labels: [...doubt.labels, LANGUAGES[language].label] });
    }
  }

  return [
    ...off.map(([language, setting]) => ({
      certain: true,
      text: `the operator does not inject ${LANGUAGES[language].label}: ${setting.why}`,
    })),
    ...[...doubts].map(([why, { pending, labels }]): Blocker => {
      const which = labels.join(" and ");

      return pending
        ? {
            certain: false,
            operator: true,
            pending,
            text: `${why}, so whether it injects ${which} is not known yet`,
          }
        : {
            certain: false,
            operator: true,
            text: `whether the operator injects ${which} could not be read: ${why}`,
          };
    }),
  ];
}

let remembered: { versions: string; list: { items: OperatorDeployment[] } } | undefined;

/** The last list read, so a page opened again starts from it instead of Checking. */
export function rememberedOperator(versions: string): OperatorList | undefined {
  return remembered?.versions === versions ? remembered.list : undefined;
}

/** Only a list that was read: a refusal is read again, never served from memory. */
export function rememberOperator(versions: string, list: OperatorList): void {
  if ("items" in list) remembered = { versions, list };
}
