# Project record: openapi-examples-gen

## Objective

Fill missing examples in OpenAPI 3.x JSON documents with deterministic, realistic values from schemas, formats and property names, and validate the examples already written. The same input must produce the same JSON output, and failures must be machine-readable.

## Scope

In scope:

- Deterministic generation from OpenAPI 3.x schemas through `generateExample`, including `const`/`example`/`default`/`enum` precedence, string formats, property-name heuristics, numeric bounds, arrays, objects, `allOf`, `oneOf`, `anyOf` and local `#/...` references.
- Filling missing `example` keys in `components.schemas.*`, parameters with a schema, and requestBody and response media type objects through `fillExamples`.
- Validating existing `example` values and every `examples[].value` against the schema through `validateExamples`.
- CLI subcommands `fill <file>` and `check <file>` with exit codes 0 success, 1 issues found, and 2 usage, IO, parse or limit error.
- JSON input only.

Out of scope:

- YAML.
- External `$ref` files; only local `#/...` JSON pointers are resolved.
- Writing files in place.
- Response mocking.
- Random or locale-specific fake data.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Measured values only. Leave "pending measurement" until a real figure is recorded; never estimate here.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 2125383 / 110873 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.1319 | factory ledger |

## Factory run u249 (measured from API usage)

| Date (UTC) | Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|---|
| 2026-11-10 | generation | deepseek-v4-pro | yes | 2089 | 30138 | 0 | 3584 | 0.0611 |
| 2026-11-10 | fix-1 | deepseek-flash | no | 35854 | 44289 | 0 | 1392256 | 0.0361 |
| 2026-11-10 | audit | deepseek-flash | no | 26527 | 17379 | 0 | 268032 | 0.0152 |
| 2026-11-10 | fix-2 | deepseek-flash | no | 21951 | 8906 | 0 | 350720 | 0.0097 |
| 2026-11-10 | docs | deepseek-flash | no | 24114 | 10161 | 0 | 256 | 0.0097 |

Total: $0.1319. Prices: deepseek line, as measured by its adapter. Providers serve the current version of each model id, so the date tells which version answered; versions, launch stages and price sources per line are in the factory's model register (docs/MODELS.md).
