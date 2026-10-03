// Enables each extension under packages/ once (Freelens registers new ones disabled);
// one disabled later in the UI stays disabled.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const EXTENSIONS_DIR = process.env.EXTENSIONS_DIR ?? "/home/dev/.freelens/extensions";
const USER_DATA = process.env.FREELENS_USER_DATA ?? "/home/dev/.config/Freelens";
const STATE_FILE = join(USER_DATA, "lens-extensions.json");

// Freelens' watcher registers a new directory as disabled before the next boot, so
// "missing from the state file" cannot mean "never seeded".
const SEEDED_FILE = join(USER_DATA, "seeded-extensions.json");

const log = (msg) => console.error(`[seed-extensions] ${msg}`);

// Freelens links <user-data>/node_modules/<name> only for a manifest appearing while it
// runs; one mounted at boot fails with "Cannot find module" without this.
function linkExtension(sourceDir, installedDir, name) {
  mkdirSync(dirname(installedDir), { recursive: true });

  if (existsSync(installedDir) || isBrokenLink(installedDir)) {
    const current = lstatSync(installedDir);
    if (current.isSymbolicLink()) {
      rmSync(installedDir, { force: true });
    } else {
      log(`${name}: ${installedDir} exists and is not a symlink; leaving it alone`);
      return;
    }
  }

  symlinkSync(sourceDir, installedDir, "dir");
  log(`${name}: linked ${installedDir} -> ${sourceDir}`);
}

function isBrokenLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

if (!existsSync(EXTENSIONS_DIR)) {
  log(`${EXTENSIONS_DIR} does not exist; nothing to seed`);
  process.exit(0);
}

const discovered = [];
for (const entry of readdirSync(EXTENSIONS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

  const manifestPath = join(EXTENSIONS_DIR, entry.name, "package.json");
  if (!existsSync(manifestPath)) continue;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.name) continue;
    // Freelens keys an extension by the manifest path inside that symlink tree.
    const installedDir = join(USER_DATA, "node_modules", manifest.name);
    linkExtension(join(EXTENSIONS_DIR, entry.name), installedDir, manifest.name);
    discovered.push([join(installedDir, "package.json"), manifest.name]);
  } catch (error) {
    log(`skipping ${entry.name}: ${error.message}`);
  }
}

if (discovered.length === 0) {
  log("no extensions found");
  process.exit(0);
}

// Without a migration marker Freelens migrates the file on boot and drops the seed.
const STORE_VERSION = process.env.FREELENS_EXTENSIONS_STORE_VERSION ?? "1.0.0";

let state = { extensions: [], __internal__: { migrations: { version: STORE_VERSION } } };
if (existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (error) {
    log(`could not parse ${STATE_FILE} (${error.message}); leaving it alone`);
    process.exit(0);
  }
}
state.extensions = Array.isArray(state.extensions) ? state.extensions : [];

let seeded = [];
if (existsSync(SEEDED_FILE)) {
  try {
    const parsed = JSON.parse(readFileSync(SEEDED_FILE, "utf8"));
    if (Array.isArray(parsed)) seeded = parsed;
  } catch (error) {
    log(`could not parse ${SEEDED_FILE} (${error.message}); treating it as empty`);
  }
}

const alreadySeeded = new Set(seeded);
const byId = new Map(state.extensions.map((entry) => [entry[0], entry]));
const touched = [];

for (const [id, name] of discovered) {
  if (alreadySeeded.has(name)) continue;

  const existing = byId.get(id);

  if (!existing) {
    state.extensions.push([id, { enabled: true, name }]);
  } else if (existing[1]?.enabled !== true) {
    existing[1] = { ...existing[1], enabled: true, name };
  } else {
    seeded.push(name);
    continue;
  }

  seeded.push(name);
  touched.push(name);
}

mkdirSync(USER_DATA, { recursive: true });
writeFileSync(SEEDED_FILE, JSON.stringify([...new Set(seeded)].sort(), null, 2));

if (touched.length === 0) {
  log(`nothing to enable; ${discovered.length} extension(s) already handled`);
  process.exit(0);
}

writeFileSync(STATE_FILE, JSON.stringify(state, null, "\t"));
log(`enabled on first sight: ${touched.join(", ")}`);
