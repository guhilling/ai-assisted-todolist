/**
 * Fails if `.design-sync/conventions.md` names a token, class or component that no longer exists.
 *
 * That file is prepended to the design system's README and inlined into the system prompt of the
 * agent that builds UI with these components. It never sees this repository, so it takes the
 * header at its word: rename a class in `App.css` and the agent keeps writing the old name,
 * which resolves to nothing and ships **silently unstyled** markup. Nothing downstream catches
 * that -- the page renders, it is just wrong.
 *
 * The header is checked against the built stylesheet rather than the sources, because the build
 * is what the design system actually ships. Run it after `npm run build:ds`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = dirname(frontend);

const header = join(repo, '.design-sync', 'conventions.md');
const stylesheet = join(frontend, 'dist-ds', 'frontend.css');
const components = join(frontend, 'src', 'components');

function read(path, hint) {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        console.error(`${path} is missing.${hint ? ` ${hint}` : ''}`);
        process.exit(1);
    }
}

const conventions = read(header, 'It is the design agent’s only description of this system.');
const css = read(stylesheet, 'Run `npm run build:ds` first.');

/** Everything the stylesheet actually defines, and every component that actually exists. */
const definedTokens = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const definedClasses = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
const definedComponents = new Set(
    readdirSync(components)
        .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
        .map((file) => file.slice(0, -'.tsx'.length)),
);

// Only backticked names are claims about this system; prose is not. A bare `--low` inside a
// "(+ `--low` / `--medium` / `--high`)" shorthand is a modifier suffix, not a token, so those
// three are resolved against the class they follow instead of being looked up as tokens.
const MODIFIER_SUFFIXES = new Set(['--low', '--medium', '--high']);
const claimed = [...conventions.matchAll(/`(--[a-z0-9-]+|\.[a-z][a-z0-9-]*)`/g)].map((m) => m[1]);

const unknownTokens = claimed
    .filter((name) => name.startsWith('--') && !MODIFIER_SUFFIXES.has(name))
    .filter((name) => !definedTokens.has(name));

const unknownClasses = claimed
    .filter((name) => name.startsWith('.'))
    .map((name) => name.slice(1))
    .filter((name) => !definedClasses.has(name));

// Components appear in the JSX example rather than in backticks.
const unknownComponents = [...new Set([...conventions.matchAll(/<([A-Z][A-Za-z]*)/g)].map((m) => m[1]))]
    .filter((name) => !definedComponents.has(name));

// Deduplicated: a name repeated in the header is one broken name, not several.
const problems = [
    ['token', unknownTokens],
    ['class', unknownClasses],
    ['component', unknownComponents],
]
    .map(([kind, names]) => [kind, [...new Set(names)].sort()])
    .filter(([, names]) => names.length > 0);

if (problems.length > 0) {
    console.error(
        'conventions.md names things that no longer exist. The design agent is given this file '
        + 'verbatim, so every name in it has to resolve:\n'
        + problems.map(([kind, names]) => `  unknown ${kind}(s): ${names.join(', ')}`).join('\n')
        + '\n\nFix the header, or the agent will keep writing names that style nothing.',
    );
    process.exit(1);
}

const counted = claimed.filter((n) => !MODIFIER_SUFFIXES.has(n)).length;
console.log(`conventions.md: ${counted} token/class names and ${definedComponents.size} components all verify.`);
