# Security practices

How this repository keeps the package and its users safe. The disclosure policy is in
[../SECURITY.md](../SECURITY.md).

## Threat model

Defended:

- The CLI checks the file size with `stat` and again after reading; files over 10,000,000 bytes are rejected with `input_too_large`.
- Invalid JSON is rejected with `invalid_json`, and a root value that is not a JSON object is rejected with `invalid_document`.
- Only local `#/...` JSON pointers are resolved. External `$ref` values and unresolved pointers produce structured failures instead of fetching anything.
- Generation is bounded: default `maxDepth` 32, at most 100,000 schema-node visits, at most 50 object properties, arrays requiring more than 10 items fail with `too_many_items`, and `uniqueItems` with more than one item fails with `unsupported`.
- Library code uses `JSON.parse` and `RegExp` with the Unicode flag; it does not use `eval`, dynamic `Function` construction or shell commands.

Not defended:

- Schema `pattern` strings are compiled and executed without a timeout. A malicious or pathological regular expression can consume CPU time.
- There is no YAML parser, no external `$ref` resolution, no file writing, and no response mocking.
- The CLI does not sandbox the filesystem or OS; it reads the path the caller supplies subject to the size limit.
- When the library functions are called directly with large objects, the 10,000,000-byte input check does not apply.

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- `gitleaks` runs as the last step of `npm run check` and as a dedicated CI job. Its configuration is
  `.gitleaks.toml`.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- The package has no runtime dependencies.
- Development dependencies are limited to the toolchain used by the repository.
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- Commit the generated `package-lock.json` so installs are reproducible.

## Code

- No `eval`, dynamic `Function` construction or shelling out from library code.
- Caller inputs are validated; `ExamplesError` carries a stable code for CLI failures.
- Schema patterns are compiled with `new RegExp(pattern, 'u')` and checked with `test`.
- The `security` step of `npm run check` runs ESLint with eslint-plugin-security only. Its configuration is
  `scripts/eslint-security.config.mjs`; inline `eslint-disable` comments are ignored.

## Publishing

- Packages are published from a clean checkout after `npm run check` passes.
- Only built output and type declarations are included in the published tarball.
