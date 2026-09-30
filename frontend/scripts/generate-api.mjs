/**
 * Generates the wire types and the response validators from the backend's published schemas.
 *
 *     npm run generate:api
 *
 * It reads `doc/api/schema/*.schema.json` — the JSON Schema documents the backend build
 * produces, committed at the repository root — and writes three files to `src/generated/`:
 *
 *     types.d.ts       one TypeScript type per schema
 *     validators.js    Ajv, compiled ahead of time to plain JavaScript
 *     validators.d.ts  each validator typed as a predicate over the matching type
 *
 * Why generated rather than hand-written: `api.ts` used to declare these types itself, with
 * comments saying the backend's enums "must be changed together" with them. That is a
 * convention that depends on being remembered. Generating them makes drift impossible, and
 * `frontend-ci.yml` fails if the committed output does not match the schemas.
 *
 * Why the validators are compiled here rather than at runtime: Ajv's standalone mode turns a
 * schema into ordinary JavaScript, so nothing new is shipped to the browser and `ajv` stays a
 * devDependency. That property is *asserted* below — if the compiled output ever needs an
 * `import` at runtime, this fails rather than quietly adding a dependency.
 *
 * Why only the responses get validators: the backend validates what it is sent, and returns
 * 400 when it does not like it. What this application has no defence against is the other
 * direction, which is what `doc/decisions.md` records as the reason any of this exists.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_DIR = join(FRONTEND, '..', 'doc', 'api', 'schema');
const OUT_DIR = join(FRONTEND, 'src', 'generated');

/** The shapes the frontend parses. Everything else here is a type only. */
const VALIDATED = ['TaskResponse', 'CurrentUserResponse', 'AuthProvidersResponse'];

/**
 * The keywords this generator understands.
 *
 * Anything else is a construct it would have to guess at, so it fails instead. A generator
 * that silently ignored an unknown keyword would emit a type or a validator that is weaker
 * than the schema it came from, which is the one failure mode that must not be quiet.
 */
const KNOWN = new Set([
    '$schema', '$id', '$ref', 'type', 'enum', 'properties', 'required', 'items',
    'format', 'examples', 'description', 'title', 'maxLength', 'pattern',
]);

/**
 * `format: date` as a regular expression rather than through `ajv-formats`.
 *
 * A RegExp is inlined into the compiled output, where a function would have to be imported
 * from a package at runtime. The cost is that this checks the shape and the ranges but not the
 * calendar, so 2026-02-30 passes. A due date that cannot exist is a backend bug that shows up
 * as an odd label, not something a malformed response could exploit.
 */
const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/**
 * `format: email`, deliberately looser than it could be.
 *
 * This checks responses from our own backend, whose `@Email` constraint accepts anything with
 * a local part, an at sign and a domain -- `a@b` included. A stricter pattern here would reject
 * a value the backend considers valid and had already stored, which is a worse failure than
 * letting an odd-looking address through to be rendered.
 */
const EMAIL = /^[^@\s]+@[^@\s]+$/;

/** Reads every schema, keyed by the file name that is also its `$id`. */
function readSchemas() {
    const names = readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.schema.json')).sort();
    return new Map(names.map((name) => [name, JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8'))]));
}

/** `TaskResponse.schema.json` names the type `TaskResponse`, here and in every `$ref`. */
function typeName(id) {
    return id.replace(/\.schema\.json$/, '');
}

function fail(message) {
    console.error(`${message}\nEither teach scripts/generate-api.mjs about it, or keep the backend's schema within what it supports.`);
    process.exit(1);
}

/** Rejects a schema node using a keyword this generator has no rule for. */
function checkKnown(node, where) {
    for (const keyword of Object.keys(node)) {
        if (!KNOWN.has(keyword)) fail(`${where}: unsupported JSON Schema keyword "${keyword}".`);
    }
}

/** The TypeScript for one schema node: a property, an array item, or a whole schema. */
function tsType(node, where) {
    checkKnown(node, where);
    // A property can carry both a $ref and a redundant restatement of the referenced type.
    // The reference is the more specific of the two, and naming it keeps the alias visible.
    if (node.$ref) return typeName(node.$ref);

    const declared = Array.isArray(node.type) ? node.type : [node.type];
    const nullable = declared.includes('null');
    const concrete = declared.filter((type) => type !== 'null');
    if (concrete.length !== 1) fail(`${where}: expected exactly one non-null type, got ${JSON.stringify(node.type)}.`);

    const [type] = concrete;
    let rendered;
    if (node.enum) {
        if (type !== 'string') fail(`${where}: enum of ${type} is not supported, only of string.`);
        rendered = node.enum.map((value) => `'${value}'`).join(' | ');
    } else if (type === 'string') {
        rendered = 'string';
    } else if (type === 'integer' || type === 'number') {
        rendered = 'number';
    } else if (type === 'boolean') {
        rendered = 'boolean';
    } else if (type === 'array') {
        const item = tsType(node.items, `${where}/items`);
        rendered = item.includes(' | ') ? `(${item})[]` : `${item}[]`;
    } else {
        fail(`${where}: unsupported type "${type}".`);
    }
    return nullable ? `${rendered} | null` : rendered;
}

/** One exported type declaration, with a comment saying where it came from. */
function declaration(id, schema) {
    const name = typeName(id);
    const origin = ` * Generated from \`doc/api/schema/${id}\`. Do not edit.`;

    if (schema.type === 'object') {
        checkKnown(schema, name);
        const required = new Set(schema.required ?? []);
        const fields = Object.entries(schema.properties ?? {}).map(([property, node]) => {
            const optional = required.has(property) ? '' : '?';
            return `    ${property}${optional}: ${tsType(node, `${name}.${property}`)};`;
        });
        return `/**\n * The \`${name}\` the backend speaks.\n *\n${origin}\n */\nexport type ${name} = {\n${fields.join('\n')}\n};\n`;
    }

    return `/**\n * The \`${name}\` the backend speaks.\n *\n${origin}\n */\nexport type ${name} = ${tsType(schema, name)};\n`;
}

function writeTypes(schemas) {
    const body = [...schemas].map(([id, schema]) => declaration(id, schema)).join('\n');
    writeFileSync(
        join(OUT_DIR, 'types.d.ts'),
        '/**\n * The types the backend speaks, generated from its published JSON Schemas.\n *\n'
        + ' * Written by `npm run generate:api`; `frontend-ci.yml` fails if this file and the schemas\n'
        + ' * under `doc/api/schema/` have come apart. Edit the backend, not this.\n */\n\n'
        + body,
    );
}

function writeValidators(schemas) {
    const ajv = new Ajv2020({ schemas: [...schemas.values()], code: { source: true, esm: true } });
    ajv.addFormat('date', DATE);
    ajv.addFormat('email', EMAIL);
    // int64 says the integer fits 64 bits, which JavaScript cannot represent past 2^53 and so
    // cannot check. `type: integer` already rejects a fraction and a string; the safe-integer
    // range is checked where it matters, in api.ts, on the value about to address a task.
    ajv.addFormat('int64', true);

    const code = standaloneCode(
        ajv,
        Object.fromEntries(VALIDATED.map((name) => [`validate${name}`, `${name}.schema.json`])),
    );

    const needed = [...new Set(
        [...code.matchAll(/(?:^|[^.\w])(?:require\(|import\s[^;]*?from\s)["']([^"']+)["']/g)]
            .map((match) => match[1]),
    )];
    // Ajv's own helpers are allowed: a keyword like `maxLength` compiles to a call into
    // ajv/dist/runtime, which Vite resolves and bundles at build time, so ajv stays a
    // devDependency and nothing new is installed to run the app. Anything else is a package
    // the browser would need, and is refused -- that is what this check is for. Adding
    // `format: date` or `email` through ajv-formats would land here, which is why both are
    // registered above as regular expressions instead.
    const shipped = needed.filter((module) => !module.startsWith('ajv/dist/runtime/'));
    if (shipped.length > 0) {
        fail(`the compiled validators want ${shipped.join(', ')} at runtime, which would make it a shipped dependency rather than a build-time one. Narrow what is validated, or decide to take the dependency deliberately.`);
    }

    writeFileSync(
        join(OUT_DIR, 'validators.js'),
        '/* eslint-disable */\n'
        + '/* Generated by `npm run generate:api` from doc/api/schema. Do not edit.\n'
        + '   Ajv compiled ahead of time, so nothing here needs ajv at runtime. */\n'
        + `${code}\n`,
    );

    const types = VALIDATED.join(', ');
    writeFileSync(
        join(OUT_DIR, 'validators.d.ts'),
        '/**\n * The compiled validators, typed as predicates over the generated types.\n *\n'
        + ' * Written by `npm run generate:api`. A validator narrows `unknown` to the type its schema\n'
        + ' * describes, which is the difference between this and the `as` it replaced: the claim is\n'
        + ' * made by a check that runs, not by an assertion the compiler erases.\n */\n'
        + `import type { ${types} } from './types';\n\n`
        + '/** One Ajv validator: a type guard that also reports why it said no. */\n'
        + 'export type Validator<T> = ((data: unknown) => data is T) & {\n'
        + '    errors?: { instancePath: string; message?: string }[] | null;\n'
        + '};\n\n'
        + VALIDATED.map((name) => `export declare const validate${name}: Validator<${name}>;\n`).join(''),
    );
}

const schemas = readSchemas();
mkdirSync(OUT_DIR, { recursive: true });
writeTypes(schemas);
writeValidators(schemas);
console.log(`generated ${schemas.size} types and ${VALIDATED.length} validators in src/generated/`);
