// Enables each extension under packages/ once (Freelens registers new ones disabled);
// one disabled later in the UI stays disabled.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const USER_DATA = process.env.FREELENS_USER_DATA ?? "/home/dev/.config/Freelens";
const EXTENSIONS_DIR = process.env.EXTENSIONS_DIR ?? join(USER_DATA, "extensions");
const STATE_FILE = join(USER_DATA, "lens-extensions.json");

// Freelens' watcher registers a new directory as disabled before the next boot, so
// "missing from the state file" cannot mean "never seeded".
// Not seeded-extensions.json: that one lists names enabled under the old path keys.
const SEEDED_FILE = join(USER_DATA, "seeded-extensions-v2.json");

const log = (msg) => console.error(`[seed-extensions] ${msg}`);

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
    // Freelens 2 keys an extension by its manifest name.
    if (manifest.name) discovered.push(manifest.name);
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

for (const name of discovered) {
  if (alreadySeeded.has(name)) continue;

  const existing = byId.get(name);

  if (!existing) {
    state.extensions.push([name, { enabled: true, name }]);
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
