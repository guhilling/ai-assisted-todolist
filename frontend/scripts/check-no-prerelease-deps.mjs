/**
 * Fails if any installed dependency resolves to a pre-release version.
 *
 * This is the npm counterpart to the backend's `requireReleaseDeps` enforcer rule. npm has
 * no notion of a SNAPSHOT, so the thing to look for is a semver pre-release suffix —
 * `-beta.2`, `-rc.1`, `-canary.a1b2c3` — which is what you get from installing a `next` or
 * `canary` dist-tag. Those move without warning and must not end up in a release.
 *
 * It reads `package-lock.json` rather than `package.json`, because a caret range on a
 * direct dependency says nothing about what a transitive dependency actually resolved to.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The project to check: the frontend by default, or the directory given -- the mobile app runs
// this same check on its own lockfile (#267).
const project = process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url)));
const lockfile = join(project, 'package-lock.json');

/**
 * Pre-releases that are the only version there is, each exactly as installed and with its reason.
 * Not a way around the rule: an entry names one version, so anything newer fails again.
 */
const ACCEPTED = new Map([
    // Babel's @babel/core depends on it, and with it every React Native build (#267). It has had
    // no other release since 2018, so there is nothing stable to pin to.
    ['gensync', '1.0.0-beta.2'],
]);

/** Matches a semver pre-release suffix: the hyphen after `major.minor.patch`. */
const PRERELEASE = /^\d+\.\d+\.\d+-/;

const lock = JSON.parse(readFileSync(lockfile, 'utf8'));

const offenders = Object.entries(lock.packages ?? {})
    // The root package is the "" key; it is this project, not a dependency.
    .filter(([path, meta]) => path !== '' && typeof meta.version === 'string')
    .filter(([, meta]) => PRERELEASE.test(meta.version))
    .filter(([path, meta]) => ACCEPTED.get(path.replace(/^.*node_modules\//, '')) !== meta.version)
    .map(([path, meta]) => `  ${path.replace(/^node_modules\//, '')}@${meta.version}`);

if (offenders.length > 0) {
    console.error(
        `A release cannot depend on a pre-release version. Found ${offenders.length}:\n` +
        `${offenders.join('\n')}\n\n` +
        'Pin these to a stable release before tagging.',
    );
    process.exit(1);
}

console.log(`No pre-release dependencies among ${Object.keys(lock.packages ?? {}).length - 1} packages.`);
