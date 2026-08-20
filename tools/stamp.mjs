#!/usr/bin/env node
/* Stamp the build identity into the files that are served.
 *
 * This used to happen in the Pages workflow, which could not work: the
 * repository also has GitHub's built-in branch-based Pages build enabled, and
 * that one publishes the committed files. Both fire on every push to main and
 * whichever finishes last wins, so a deploy-time edit was being thrown away
 * about half the time — the site kept reporting "dev" while the workflow log
 * showed a correct stamp.
 *
 * Stamping at commit time removes the race instead of trying to win it: both
 * publishers then serve identical bytes. It also makes a clone self-describing
 * and gives the service worker a cache name that changes exactly when the code
 * does.
 *
 * The id is a hash of the site's own content rather than a commit sha, which
 * would be unknowable from inside the commit that has to contain it. Files
 * that carry the stamp are excluded from the hash, so the result is stable:
 * stamping twice over unchanged code produces the same id.
 *
 *   node tools/stamp.mjs           write the stamp
 *   node tools/stamp.mjs --check   verify it matches the content, else exit 1
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Files whose content is the app. */
const INCLUDE_DIRS = ['js', 'css'];
const INCLUDE_FILES = ['index.html', 'manifest.webmanifest'];

/** Excluded because they carry the stamp — hashing them would not converge. */
const STAMPED = ['js/version.js', 'version.json', 'sw.js'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function contentFiles() {
  const files = [];
  for (const d of INCLUDE_DIRS) files.push(...walk(join(root, d)));
  for (const f of INCLUDE_FILES) files.push(join(root, f));
  return files
    .map((f) => relative(root, f).split(sep).join('/'))
    .filter((f) => !STAMPED.includes(f))
    .sort();
}

/** A short id that changes when, and only when, the served code changes. */
export function buildId() {
  const hash = createHash('sha256');
  for (const rel of contentFiles()) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(join(root, rel)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 7);
}

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

/** The three stamped files as they should be for a given id. */
function stamped(id, builtAt) {
  const version = read('js/version.js').replace(
    /export const VERSION = \{[\s\S]*?\};/,
    `export const VERSION = {\n  id: '${id}',\n  builtAt: '${builtAt}',\n};`,
  );
  const sw = read('sw.js').replace(
    /^const VERSION = '.*';$/m,
    `const VERSION = 'synthia-${id}';`,
  );
  return {
    'js/version.js': version,
    'sw.js': sw,
    'version.json': `{"id":"${id}","builtAt":"${builtAt}"}\n`,
  };
}

/** The builtAt already recorded, so --check doesn't fail on the clock alone. */
function currentBuiltAt() {
  return read('js/version.js').match(/builtAt: '([^']*)'/)?.[1] ?? '';
}

const check = process.argv.includes('--check');
const id = buildId();
const builtAt = check ? currentBuiltAt() : new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const want = stamped(id, builtAt);

let bad = 0;
for (const [rel, content] of Object.entries(want)) {
  if (check) {
    if (read(rel) !== content) {
      console.error(`✗ ${rel} is not stamped for build ${id}`);
      bad++;
    }
  } else {
    writeFileSync(join(root, rel), content);
  }
}

if (check) {
  if (bad) {
    console.error(`\nRun: node tools/stamp.mjs`);
    process.exit(1);
  }
  console.log(`✓ stamped for build ${id}`);
} else {
  console.log(`Stamped build ${id} at ${builtAt}`);
}
