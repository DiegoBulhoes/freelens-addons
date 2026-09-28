// Freelens registers a newly discovered local extension as disabled, so a fresh
// state volume would mean clicking through the Extensions page before anything
// under packages/ runs. This pre-registers each one as enabled.
//
// Only missing entries are added: an extension deliberately disabled in the UI
// stays disabled across restarts.
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

// Records which extensions this script has already enabled once. Without it,
// "enable what is missing from the state file" is not enough: Freelens' watcher
// registers an extension the moment its directory appears — as disabled — so by
// the next boot the entry exists and the script leaves it alone, and a newly
// added extension would need a click in the UI on every fresh environment.
const SEEDED_FILE = join(USER_DATA, "seeded-extensions.json");

const log = (msg) => console.error(`[seed-extensions] ${msg}`);

/**
 * Recreate the symlink Freelens' own installer would have made.
 *
 * Freelens links an extension into <user-data>/node_modules/<name> only when it
 * sees the manifest appear in the watched folder while running. Extensions that
 * are already mounted at boot never fire that event, so the link is missing and
 * `require` of the entrypoint fails with "Cannot find module". Creating it here
 * makes a pre-mounted extension behave like an installed one.
 */
function linkExtension(sourceDir, installedDir, name) {
  mkdirSync(dirname(installedDir), { recursive: true });

  if (existsSync(installedDir) || isBrokenLink(installedDir)) {
    const current = lstatSync(installedDir);
    if (current.isSymbolicLink()) {
      // Repoint it: the source path can change between runs.
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
    // The key Freelens uses is the manifest inside the symlink tree it builds
    // under the user-data directory, not the path the file was read from.
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

// A file without a migration marker makes Freelens run its store migrations on
// boot, which discards whatever was seeded here. A file this script creates is
// new by definition and has nothing to migrate, so it is stamped as current.
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
    // Registered by Freelens itself when it saw the directory appear, which it
    // always does as disabled. This is still the extension's first sighting as
    // far as this script is concerned, so enable it.
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
