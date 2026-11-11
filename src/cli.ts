/**
 * Command-line interface for @trysac/openapi-examples-gen.
 */
import { readFile, stat } from "node:fs/promises";
import { ExamplesError, fillExamples, validateExamples } from "./index.js";

export interface CliIO {
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
}

const MAX_INPUT_BYTES = 10_000_000;

function writeUsage(stderr: CliIO["stderr"]): void {
  stderr.write("Usage: openapi-examples-gen <fill|check> <file>\n");
}

/**
 * Runs the CLI with the given arguments and I/O streams.
 *
 * @param argv - Process arguments (without node and script path).
 * @param io - Stdout and stderr writers.
 * @returns Exit code: 0 success, 1 issues found, 2 usage/IO/parse/limit error.
 */
export async function run(argv: string[], io: CliIO): Promise<number> {
  if (argv.length !== 2) {
    writeUsage(io.stderr);
    return 2;
  }

  const command = argv[0];
  const file = argv[1] as string;
  if (command !== "fill" && command !== "check") {
    writeUsage(io.stderr);
    return 2;
  }

  try {
    const fileStats = await stat(file);
    if (fileStats.size > MAX_INPUT_BYTES) {
      throw new ExamplesError("input_too_large", `Input file exceeds ${MAX_INPUT_BYTES} bytes`);
    }

    const contentBuffer = await readFile(file);
    if (contentBuffer.byteLength > MAX_INPUT_BYTES) {
      throw new ExamplesError("input_too_large", `Input file exceeds ${MAX_INPUT_BYTES} bytes`);
    }

    let doc: unknown;
    try {
      doc = JSON.parse(contentBuffer.toString("utf8"));
    } catch {
      throw new ExamplesError("invalid_json", "Invalid JSON input");
    }

    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      throw new ExamplesError("invalid_document", "Document must be a JSON object");
    }

    if (command === "fill") {
      const result = fillExamples(doc as object);
      io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    // check
    const issues = validateExamples(doc as object);
    if (issues.length > 0) {
      for (const issue of issues) {
        io.stdout.write(`${issue.pointer}: ${issue.message}\n`);
      }
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof ExamplesError) {
      io.stderr.write(`${err.code}\n`);
      return 2;
    }
    io.stderr.write("error\n");
    return 2;
  }
}
