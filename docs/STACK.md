# Stack

## Used

| Tool | Purpose | Why |
|---|---|---|
| TypeScript | Language and type checking | Typed public API and declarations for consumers. |
| Node.js 20+ | Runtime | ES modules and `node:fs/promises` for the CLI. |
| Vitest | Tests | Tests in `test/cli.test.ts` and `test/index.test.ts` use `describe`, `it`, `expect` and `vi`. |
| Biome | Lint and format | One tool for both, single config file. |
| gitleaks | Secret scanning | Runs locally and in CI. |
| GitHub Actions + Dependabot | CI wrapper and updates | Runs the same local gates on Linux and Windows. |

## Discarded

| Tool | Why not |
|---|---|
| Runtime dependencies | The package has no runtime dependencies. |
| YAML parser | Input is JSON only; YAML is out of scope. |
| Bundlers (tsup, Rollup) | Unneeded for a small ESM library; `tsc` emits what is published. |
