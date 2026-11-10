import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";

function filePath(name: string): string {
  return join(tmpdir(), `openapi-examples-gen-${name}`);
}

describe("CLI", () => {
  it("acceptance: run check with issues returns 1 and writes pointer: message lines", async () => {
    const doc = {
      components: {
        schemas: {
          User: {
            type: "object",
            properties: { age: { type: "integer", minimum: 18 } },
            example: { age: 10 },
          },
        },
      },
    };
    const file = filePath("check.json");
    await writeFile(file, JSON.stringify(doc));
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run(["check", file], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(1);
    expect(stdoutWrite).toHaveBeenCalledWith(
      "/components/schemas/User/example/age: must be >= 18\n",
    );
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("check without issues returns 0 and writes nothing", async () => {
    const file = filePath("check-ok.json");
    await writeFile(file, JSON.stringify({ components: { schemas: {} } }));
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run(["check", file], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(0);
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("acceptance: run fill writes JSON result and returns 0", async () => {
    const doc = {
      components: {
        schemas: {
          User: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      },
    };
    const file = filePath("fill.json");
    await writeFile(file, JSON.stringify(doc));
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run(["fill", file], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(0);
    const output = stdoutWrite.mock.calls[0]?.[0];
    expect(output).toBeTypeOf("string");
    expect(output.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(output as string);
    expect(parsed.added).toEqual(["/components/schemas/User/example"]);
  });

  it("acceptance: input over 10_000_000 bytes returns 2 and writes input_too_large", async () => {
    const file = filePath("large.json");
    const largeContent = `{"a":"${"x".repeat(10_000_001)}"}`;
    await writeFile(file, largeContent);
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run(["check", file], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(2);
    expect(stderrWrite).toHaveBeenCalledWith("input_too_large\n");
  });

  it("usage errors return 2", async () => {
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run([], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(2);
    expect(stderrWrite).toHaveBeenCalled();
  });

  it("unknown commands return 2", async () => {
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run(["nope", "spec.json"], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(2);
    expect(stderrWrite).toHaveBeenCalled();
  });

  it("invalid JSON returns 2 and writes invalid_json", async () => {
    const file = filePath("invalid.json");
    await writeFile(file, "not json");
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run(["check", file], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(2);
    expect(stderrWrite).toHaveBeenCalledWith("invalid_json\n");
  });

  it("non-object documents return 2 and write invalid_document", async () => {
    const file = filePath("array.json");
    await writeFile(file, "[1,2,3]");
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run(["fill", file], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(2);
    expect(stderrWrite).toHaveBeenCalledWith("invalid_document\n");
  });

  it("read errors return 2 and write error", async () => {
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const exitCode = await run(["check", filePath("does-not-exist.json")], {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
    });
    expect(exitCode).toBe(2);
    expect(stderrWrite).toHaveBeenCalledWith("error\n");
  });
});
