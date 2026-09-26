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

const lockfile = join(dirname(dirname(fileURLToPath(import.meta.url))), 'package-lock.json');

/** Matches a semver pre-release suffix: the hyphen after `major.minor.patch`. */
const PRERELEASE = /^\d+\.\d+\.\d+-/;

const lock = JSON.parse(readFileSync(lockfile, 'utf8'));

const offenders = Object.entries(lock.packages ?? {})
    // The root package is the "" key; it is this project, not a dependency.
    .filter(([path, meta]) => path !== '' && typeof meta.version === 'string')
    .filter(([, meta]) => PRERELEASE.test(meta.version))
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
