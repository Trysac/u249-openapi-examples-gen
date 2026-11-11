# Architecture

## Overview

`@trysac/openapi-examples-gen` is a dependency-free TypeScript library published to npm as ES modules with type declarations. It fills missing examples in OpenAPI 3.x JSON documents with deterministic values and validates the examples already written.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API. Exports `generateExample`, `fillExamples`, `validateExamples`, `ExamplesError`, and the related result and option types. |
| `src/cli.ts` | Command-line entry. Exports `run(argv, io)`, reads a JSON file, applies the size limit, and dispatches `fill` or `check`. |

## Boundaries

- No runtime dependencies.
- Library functions do not perform I/O. The CLI performs file reads and writes to injected stdout and stderr streams.
- `fillExamples` returns a deep copy created with `JSON.parse(JSON.stringify(doc))`; it does not mutate the input document.
- Only local `#/...` JSON pointers are resolved. External `$ref` values are unsupported.
- Generation is bounded by `maxDepth` (default 32), 100,000 schema-node visits, and 50 object properties.
- CLI input is limited to 10,000,000 bytes and must parse as a JSON object.

## Build and distribution

`npm run build` compiles `src/` to `dist/` with `tsconfig.build.json`. Only `dist/` is published
(`files` in `package.json`).

## Decisions

Architectural decisions are recorded in [decisions/](decisions/), starting with
[0001](decisions/0001-record-architecture-decisions.md).
