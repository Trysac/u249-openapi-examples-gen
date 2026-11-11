# openapi-examples-gen

[![npm version](https://img.shields.io/npm/v/@trysac/openapi-examples-gen.svg)](https://www.npmjs.com/package/@trysac/openapi-examples-gen)
[![license: MIT](https://img.shields.io/npm/l/@trysac/openapi-examples-gen.svg)](LICENSE)
[![CI](https://github.com/Trysac/u249-openapi-examples-gen/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u249-openapi-examples-gen/actions/workflows/ci.yml)

Fill missing examples in OpenAPI 3.x JSON documents with deterministic, realistic values from schemas, formats and property names, and validate the examples already written.

## Problem

API documentation without examples is hard to read, and examples written by hand drift from the schema: a required field disappears, an enum value is renamed, a date has the wrong format, and nobody notices until a client copies it. Random fake-data generators produce different output on every run, which makes diffs of the documentation noisy. This library writes deterministic, plausible examples only where they are missing and checks the existing ones against their schemas.

## Install

```sh
npm install @trysac/openapi-examples-gen
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has no runtime dependencies. Input is JSON only; YAML is out of scope.

## Usage

```ts
import { generateExample, fillExamples, validateExamples } from '@trysac/openapi-examples-gen';
const schema = { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } };
console.log(generateExample(schema)); // { ok: true, value: { email: 'user@example.com' } }
const filled = fillExamples({ components: { schemas: { User: schema } } });
console.log(filled.added); // ['/components/schemas/User/example']
console.log(validateExamples(filled.document)); // []
```

CLI after build: `node dist/cli.js fill spec.json` prints the fill result as JSON and exits 0; `node dist/cli.js check spec.json` prints `pointer: message` lines and exits 1 when issues exist. Both commands exit 2 on usage, IO, parse or limit errors and write the error code to stderr.

## API

| Export | Signature | Description |
|---|---|---|
| `generateExample` | `(schema: object, opts?: { root?: object; propertyName?: string; maxDepth?: number }) => GenerateExampleResult` | Generates one deterministic value for a schema; returns `{ ok: true, value }` or `{ ok: false, pointer, reason }`. `maxDepth` defaults to 32. |
| `fillExamples` | `(doc: object, opts?: { overwrite?: boolean }) => { document: object; added: string[]; skipped: { pointer: string; reason: string }[] }` | Returns a deep copy of the document with missing examples filled, plus the RFC 6901 pointers that were added or skipped. `overwrite` defaults to false and replaces only `example` keys. |
| `validateExamples` | `(doc: object) => { pointer: string; message: string }[]` | Checks every `example` and `examples[].value` against its schema for type, enum, const, required, properties, additionalProperties false, items, numeric bounds, multipleOf, string length, pattern and known formats. |
| `run` | `(argv: string[], io: { stdout: { write(s: string): void }; stderr: { write(s: string): void } }) => Promise<number>` | CLI entry point in `src/cli.ts`; subcommands are `fill <file>` and `check <file>`. Exit codes are 0 success, 1 issues found, 2 usage, IO, parse or limit error. |
| `ExamplesError` | `class ExamplesError extends Error` | Error with a stable `code`: `input_too_large`, `invalid_json`, `invalid_document` or `unresolved_ref`. |
| `GenerationFailureReason` | `'pattern' \| 'cyclic_required' \| 'too_deep' \| 'unsupported' \| 'too_many_items'` | Type of the `reason` field in a failed `generateExample` result. |

Limits: the CLI rejects input over 10,000,000 bytes; generation visits at most 100,000 schema nodes and defaults to `maxDepth` 32; objects are generated with at most 50 properties; arrays requiring more than 10 items fail with `too_many_items`; `uniqueItems` with more than one item fails with `unsupported`. Only local `#/...` JSON pointers are supported for `$ref`.

Security policy: [docs/SECURITY.md](docs/SECURITY.md).

## Why not a mock server or fake-data library

A mock server or fake-data library generates responses at runtime or random data, while this utility edits the OpenAPI document itself, only where examples are missing, and produces byte-identical JSON for the same input. It does not mock responses, write files in place, or generate random or locale-specific fake data.

## Development

```sh
npm install
npm run check
```

Tests are in `test/cli.test.ts` and `test/index.test.ts`.

## License

[MIT](LICENSE).
