import { describe, expect, it } from "vitest";
import { ExamplesError, fillExamples, generateExample, validateExamples } from "../src/index.js";

function getAt(doc: object, path: string[]): unknown {
  let current: unknown = doc;
  for (const key of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

describe("generateExample", () => {
  it("acceptance: object with required email, optional firstName, age minimum", () => {
    const schema = {
      type: "object",
      required: ["email"],
      properties: {
        email: { type: "string", format: "email" },
        firstName: { type: "string" },
        age: { type: "integer", minimum: 18 },
      },
    };
    const result = generateExample(schema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        email: "user@example.com",
        firstName: "Jane",
        age: 18,
      });
    }
  });

  it("acceptance: scalar values", () => {
    expect(generateExample({ type: "integer", minimum: 7, multipleOf: 5 })).toEqual({
      ok: true,
      value: 10,
    });
    expect(generateExample({ type: "number" })).toEqual({ ok: true, value: 1.5 });
    expect(generateExample({ type: "string", minLength: 8 })).toEqual({
      ok: true,
      value: "stringxx",
    });
    expect(generateExample({ type: "string", maxLength: 3 })).toEqual({ ok: true, value: "str" });
    expect(generateExample({ type: "boolean" })).toEqual({ ok: true, value: true });
    expect(generateExample({ enum: ["b", "a"] })).toEqual({ ok: true, value: "b" });
    expect(generateExample({ const: "z", example: "y" })).toEqual({ ok: true, value: "z" });
  });

  it("acceptance: string formats", () => {
    const cases: [string, unknown][] = [
      ["date-time", "2024-01-15T09:30:00Z"],
      ["date", "2024-01-15"],
      ["uuid", "3fa85f64-5717-4562-b3fc-2c963f66afa6"],
      ["ipv4", "192.0.2.1"],
      ["ipv6", "2001:db8::1"],
    ];
    for (const [format, expected] of cases) {
      expect(generateExample({ type: "string", format })).toEqual({
        ok: true,
        value: expected,
      });
    }
  });

  it("acceptance: fillExamples fills missing examples deterministically", () => {
    const doc = {
      openapi: "3.0.0",
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
        },
      },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          },
        },
      },
    };
    const original = JSON.parse(JSON.stringify(doc));
    const result = fillExamples(doc);
    expect(result.added).toEqual([
      "/components/schemas/User/example",
      "/paths/~1users/get/responses/200/content/application~1json/example",
    ]);
    // no mutation of input
    expect(doc).toEqual(original);
    // document contains examples
    expect(getAt(result.document, ["components", "schemas", "User", "example"])).toEqual({
      name: "Jane Doe",
    });
    expect(
      getAt(result.document, [
        "paths",
        "/users",
        "get",
        "responses",
        "200",
        "content",
        "application/json",
        "example",
      ]),
    ).toEqual({ name: "Jane Doe" });
    // existing examples unchanged
    const doc2 = {
      components: {
        schemas: {
          User: {
            type: "object",
            example: { name: "Existing" },
            properties: { name: { type: "string" } },
          },
        },
      },
    };
    const result2 = fillExamples(doc2);
    expect(getAt(result2.document, ["components", "schemas", "User", "example"])).toEqual({
      name: "Existing",
    });
  });

  it("acceptance: cyclic required vs optional", () => {
    const schema = {
      type: "object",
      required: ["value"],
      properties: {
        value: { type: "string" },
        child: { $ref: "#/components/schemas/Node" },
      },
    };
    const doc = {
      components: {
        schemas: {
          Node: schema,
        },
      },
    };
    const result = generateExample(schema, { root: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ value: "string" });
    }

    const requiredCycleSchema = {
      type: "object",
      required: ["value", "child"],
      properties: {
        value: { type: "string" },
        child: { $ref: "#/components/schemas/Node" },
      },
    };
    const doc2 = {
      components: {
        schemas: {
          Node: requiredCycleSchema,
        },
      },
    };
    const result2 = generateExample(requiredCycleSchema, { root: doc2 });
    expect(result2).toEqual({
      ok: false,
      pointer: "/child",
      reason: "cyclic_required",
    });
  });

  it("acceptance: property heuristics and pattern failure", () => {
    expect(
      generateExample({ type: "string", pattern: "^[A-Z]{3}$" }, { propertyName: "currency" }),
    ).toEqual({ ok: true, value: "USD" });

    expect(
      generateExample({ type: "string", pattern: "^[0-9]{4}$" }, { propertyName: "code" }),
    ).toEqual({ ok: false, pointer: "", reason: "pattern" });
  });

  it("acceptance: validateExamples reports numeric and format issues", () => {
    const doc = {
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              age: { type: "integer", minimum: 18 },
              email: { type: "string", format: "email" },
            },
            example: {
              age: 17,
              email: "nope",
            },
          },
        },
      },
    };
    const issues = validateExamples(doc);
    expect(issues).toEqual([
      { pointer: "/components/schemas/User/example/age", message: "must be >= 18" },
      { pointer: "/components/schemas/User/example/email", message: "must match format email" },
    ]);
  });

  it("edge case: schema with only $ref", () => {
    const doc = {
      components: {
        schemas: {
          Target: { type: "string", minLength: 5 },
        },
      },
    };
    const result = generateExample({ $ref: "#/components/schemas/Target" }, { root: doc });
    expect(result).toEqual({ ok: true, value: "string" });
  });

  it('edge case: OpenAPI 3.1 type ["string", "null"] uses first non-null type', () => {
    expect(generateExample({ type: ["string", "null"] })).toEqual({
      ok: true,
      value: "string",
    });
  });

  it("edge case: example containing unicode", () => {
    const schema = { example: "héllo wörld" };
    expect(generateExample(schema)).toEqual({ ok: true, value: "héllo wörld" });
  });

  it("edge case: parameter with examples already present is skipped", () => {
    const doc = {
      paths: {
        "/test": {
          get: {
            parameters: [
              {
                name: "q",
                in: "query",
                schema: { type: "string" },
                examples: {
                  one: { value: "already" },
                },
              },
            ],
          },
        },
      },
    };
    const result = fillExamples(doc);
    expect(result.added).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it("throws ExamplesError for invalid document in CLI? (placeholder)", () => {
    // ExamplesError is exported; basic instantiation check.
    const error = new ExamplesError("invalid_json", "bad");
    expect(error.code).toBe("invalid_json");
    expect(error).toBeInstanceOf(Error);
  });

  it("generateExample enforces maxDepth", () => {
    const schema: { type: string; required: string[]; properties: Record<string, unknown> } = {
      type: "object",
      required: ["child"],
      properties: {
        child: {
          type: "object",
          required: ["child"],
          properties: { child: { type: "string" } },
        },
      },
    };
    const result = generateExample(schema, { maxDepth: 1 });
    expect(result).toEqual({ ok: false, pointer: "/child/child", reason: "too_deep" });
  });

  it("generateExample enforces max node count", () => {
    const schema: { type: string; properties: Record<string, unknown> } = {
      type: "object",
      properties: {},
    };
    for (let i = 0; i < 60; i += 1) {
      schema.properties[`p${i}`] = { type: "string" };
    }
    const result = generateExample(schema);
    expect(result).toEqual({ ok: false, pointer: "", reason: "unsupported" });
  });

  it("generateExample handles unsupported uniqueItems >1 and minItems too large", () => {
    expect(
      generateExample({ type: "array", minItems: 2, uniqueItems: true, items: { type: "string" } }),
    ).toEqual({ ok: false, pointer: "", reason: "unsupported" });
    expect(generateExample({ type: "array", minItems: 11, items: { type: "string" } })).toEqual({
      ok: false,
      pointer: "",
      reason: "too_many_items",
    });
  });
});

describe("generateExample: numeric bounds", () => {
  it("handles exclusive minimum and maximum variants", () => {
    expect(generateExample({ type: "integer", minimum: 10, exclusiveMinimum: true })).toEqual({
      ok: true,
      value: 11,
    });
    expect(generateExample({ type: "integer", exclusiveMinimum: 10 })).toEqual({
      ok: true,
      value: 11,
    });
    const exclusiveNumber = generateExample({ type: "number", exclusiveMinimum: 2 });
    expect(exclusiveNumber.ok).toBe(true);
    if (exclusiveNumber.ok) {
      expect(exclusiveNumber.value as number).toBeGreaterThan(2);
    }
    const exclusiveNumberMultiple = generateExample({
      type: "number",
      exclusiveMinimum: 2,
      multipleOf: 0.5,
    });
    expect(exclusiveNumberMultiple.ok).toBe(true);
    if (exclusiveNumberMultiple.ok) {
      expect(exclusiveNumberMultiple.value as number).toBeGreaterThan(2);
    }
    expect(generateExample({ type: "integer", maximum: 5, exclusiveMaximum: true })).toEqual({
      ok: true,
      value: 1,
    });
    expect(generateExample({ type: "integer", maximum: 5 })).toEqual({ ok: true, value: 1 });
    expect(generateExample({ type: "integer", maximum: 0 })).toEqual({
      ok: false,
      pointer: "",
      reason: "unsupported",
    });
    expect(generateExample({ type: "integer", maximum: 5, exclusiveMaximum: 1 })).toEqual({
      ok: false,
      pointer: "",
      reason: "unsupported",
    });
  });
});

describe("generateExample: type handling", () => {
  it("handles null, nullable, unknown types and unknown formats", () => {
    expect(generateExample({ type: "null" })).toEqual({ ok: true, value: null });
    expect(generateExample({ type: ["null"] })).toEqual({ ok: true, value: null });
    expect(generateExample({ nullable: true })).toEqual({ ok: true, value: "string" });
    expect(generateExample({ type: "wat" })).toEqual({
      ok: false,
      pointer: "",
      reason: "unsupported",
    });
    expect(generateExample({ type: "string", format: "mailto" })).toEqual({
      ok: true,
      value: "string",
    });
  });

  it("handles arrays", () => {
    expect(generateExample({ type: "array", items: { type: "boolean" } })).toEqual({
      ok: true,
      value: [true],
    });
    expect(generateExample({ type: "array" })).toEqual({ ok: true, value: ["string"] });
    expect(generateExample({ type: "array", minItems: 2, items: { type: "integer" } })).toEqual({
      ok: true,
      value: [1, 1],
    });
    expect(
      generateExample({
        type: "array",
        minItems: 2,
        items: { type: "string", pattern: "^[0-9]+$" },
      }),
    ).toEqual({ ok: false, pointer: "/0", reason: "pattern" });
    expect(
      generateExample({ type: "array", minItems: 2, maxItems: 1, items: { type: "string" } }),
    ).toEqual({ ok: false, pointer: "", reason: "unsupported" });
  });

  it("omits optional properties that cannot be generated", () => {
    expect(
      generateExample({
        type: "object",
        properties: {
          bad: { type: "string", pattern: "^[0-9]+$" },
          good: { type: "integer" },
        },
      }),
    ).toEqual({ ok: true, value: { good: 1 } });
    expect(
      generateExample(
        {
          type: "object",
          required: ["a/b"],
          properties: { "a/b": { $ref: "#/components/schemas/Missing" } },
        },
        { root: {} },
      ),
    ).toEqual({ ok: false, pointer: "/a~1b", reason: "unsupported" });
  });

  it("normalizes property names for heuristics", () => {
    expect(generateExample({ type: "string" }, { propertyName: "First_Name" })).toEqual({
      ok: true,
      value: "Jane",
    });
    expect(generateExample({ type: "string" }, { propertyName: "unknownField" })).toEqual({
      ok: true,
      value: "string",
    });
  });
});

describe("generateExample: combinators", () => {
  it("merges allOf object properties and required lists", () => {
    expect(
      generateExample({
        allOf: [
          { type: "object", required: ["id"], properties: { id: { type: "integer" } } },
          { type: "object", required: ["name"], properties: { name: { type: "string" } } },
        ],
      }),
    ).toEqual({ ok: true, value: { id: 1, name: "Jane Doe" } });

    expect(
      generateExample({
        allOf: [{ type: "object", required: ["id"], properties: { id: { type: "integer" } } }],
      }),
    ).toEqual({ ok: true, value: { id: 1 } });
  });

  it("merges allOf branches that use $ref", () => {
    const doc = {
      components: {
        schemas: {
          Base: { type: "object", required: ["id"], properties: { id: { type: "integer" } } },
          Extra: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
        },
      },
    };
    expect(
      generateExample(
        {
          allOf: [{ $ref: "#/components/schemas/Base" }, { $ref: "#/components/schemas/Extra" }],
        },
        { root: doc },
      ),
    ).toEqual({ ok: true, value: { id: 1, name: "Jane Doe" } });
  });

  it("uses the first oneOf and anyOf branch", () => {
    expect(
      generateExample({
        oneOf: [{ type: "integer", minimum: 3 }, { type: "string" }],
      }),
    ).toEqual({ ok: true, value: 3 });
    expect(
      generateExample({
        anyOf: [{ type: "boolean" }, { type: "string" }],
      }),
    ).toEqual({ ok: true, value: true });
  });
});

describe("generateExample: references", () => {
  it("resolves escaped JSON pointers", () => {
    const doc = {
      components: { schemas: { "A/B": { type: "string" }, "T~U": { type: "integer" } } },
    };
    expect(generateExample({ $ref: "#/components/schemas/A~1B" }, { root: doc })).toEqual({
      ok: true,
      value: "string",
    });
    expect(generateExample({ $ref: "#/components/schemas/T~0U" }, { root: doc })).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("fails on unresolved references", () => {
    expect(generateExample({ $ref: "other.json#/A" })).toEqual({
      ok: false,
      pointer: "",
      reason: "unsupported",
    });
    expect(generateExample({ $ref: "#/components/schemas/Nope" }, { root: {} })).toEqual({
      ok: false,
      pointer: "",
      reason: "unsupported",
    });
    expect(
      generateExample(
        { $ref: "#/components/schemas/Scalar" },
        { root: { components: { schemas: { Scalar: 5 } } } },
      ),
    ).toEqual({ ok: false, pointer: "", reason: "unsupported" });
  });
});

describe("fillExamples: traversal", () => {
  it("fills parameters, request bodies and responses", () => {
    const doc = {
      paths: {
        "/items": {
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          get: {
            parameters: [
              { name: "q", in: "query", schema: { type: "string" }, example: "given" },
              { name: "broken", in: "query", schema: { type: "string", pattern: "^[0-9]+$" } },
            ],
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { name: { type: "string" } } },
                },
              },
            },
            responses: {
              "200": {
                content: { "text/plain": { schema: { type: "string" } }, "application/json": {} },
              },
            },
          },
        },
      },
    };
    const result = fillExamples(doc);
    expect(result.added).toEqual([
      "/paths/~1items/parameters/0/example",
      "/paths/~1items/get/requestBody/content/application~1json/example",
      "/paths/~1items/get/responses/200/content/text~1plain/example",
    ]);
    expect(result.skipped).toEqual([
      { pointer: "/paths/~1items/get/parameters/0/example", reason: "already has example" },
      { pointer: "/paths/~1items/get/parameters/1/example", reason: "pattern" },
    ]);
  });

  it("overwrites existing examples when asked", () => {
    const doc = {
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { name: { type: "string" } } },
                    example: { name: "Old" },
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = fillExamples(doc, { overwrite: true });
    expect(result.added).toEqual([
      "/paths/~1users/get/responses/200/content/application~1json/example",
    ]);
    expect(
      getAt(result.document, [
        "paths",
        "/users",
        "get",
        "responses",
        "200",
        "content",
        "application/json",
        "example",
      ]),
    ).toEqual({ name: "Jane Doe" });
  });

  it("skips non-schema components and non-object path items", () => {
    const result = fillExamples({
      components: { schemas: { Bad: "nope", AlsoBad: [] } },
      paths: { "/x": true },
    });
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe("validateExamples", () => {
  it("reports type, const, enum, required, items and additionalProperties issues", () => {
    const doc = {
      components: {
        schemas: {
          Shape: {
            type: "object",
            required: ["missing"],
            additionalProperties: false,
            properties: {
              a: { type: "string" },
              b: { const: 1 },
              c: { enum: ["x", "y"] },
              d: { type: "array", items: { type: "integer" } },
            },
            example: { a: 5, b: 2, c: "z", d: [1, "two"], extra: true },
          },
          NotAnObject: { type: "object", example: 5 },
          Nullable: { type: "string", nullable: true, example: null },
          MultiType: { type: ["string", "null"], example: 5 },
          UnknownType: { type: "wat", example: 1 },
          NullType: { type: "null", example: 1 },
        },
      },
    };
    const issues = validateExamples(doc);
    expect(issues.map((issue) => `${issue.pointer}: ${issue.message}`)).toEqual([
      "/components/schemas/Shape/example/missing: is required",
      "/components/schemas/Shape/example/a: must be string",
      "/components/schemas/Shape/example/b: must equal const",
      "/components/schemas/Shape/example/c: must be one of the enum values",
      "/components/schemas/Shape/example/d/1: must be integer",
      "/components/schemas/Shape/example/extra: must not have additional properties",
      "/components/schemas/NotAnObject/example: must be object",
      "/components/schemas/MultiType/example: must be string|null",
      "/components/schemas/UnknownType/example: must be wat",
      "/components/schemas/NullType/example: must be null",
    ]);
  });

  it("reports numeric issues", () => {
    const doc = {
      components: {
        schemas: {
          Numbers: {
            type: "object",
            properties: {
              min: { type: "number", minimum: 5 },
              minExclusive: { type: "number", minimum: 5, exclusiveMinimum: true },
              minExclusive31: { type: "number", exclusiveMinimum: 5 },
              max: { type: "number", maximum: 5 },
              maxExclusive: { type: "number", maximum: 5, exclusiveMaximum: true },
              maxExclusive31: { type: "number", exclusiveMaximum: 5 },
              multiple: { type: "integer", multipleOf: 2 },
              zeroMultiple: { type: "number", multipleOf: 0 },
            },
            example: {
              min: 4,
              minExclusive: 5,
              minExclusive31: 5,
              max: 6,
              maxExclusive: 5,
              maxExclusive31: 5,
              multiple: 3,
              zeroMultiple: 1,
            },
          },
        },
      },
    };
    const issues = validateExamples(doc);
    expect(issues.map((issue) => `${issue.pointer}: ${issue.message}`)).toEqual([
      "/components/schemas/Numbers/example/min: must be >= 5",
      "/components/schemas/Numbers/example/minExclusive: must be > 5",
      "/components/schemas/Numbers/example/minExclusive31: must be > 5",
      "/components/schemas/Numbers/example/max: must be <= 5",
      "/components/schemas/Numbers/example/maxExclusive: must be < 5",
      "/components/schemas/Numbers/example/maxExclusive31: must be < 5",
      "/components/schemas/Numbers/example/multiple: must be multiple of 2",
      "/components/schemas/Numbers/example/zeroMultiple: must be multiple of 0",
    ]);
  });

  it("reports string and format issues", () => {
    const doc = {
      components: {
        schemas: {
          Strings: {
            type: "object",
            properties: {
              short: { type: "string", minLength: 3 },
              long: { type: "string", maxLength: 2 },
              pattern: { type: "string", pattern: "^[0-9]+$" },
              date: { type: "string", format: "date" },
              dateTime: { type: "string", format: "date-time" },
              email: { type: "string", format: "email" },
              uuid: { type: "string", format: "uuid" },
              uri: { type: "string", format: "uri" },
              ipv4: { type: "string", format: "ipv4" },
              ipv6: { type: "string", format: "ipv6" },
              other: { type: "string", format: "mailto" },
            },
            example: {
              short: "ab",
              long: "abcd",
              pattern: "abc",
              date: "15-01-2024",
              dateTime: "2024-01-15",
              email: "nope",
              uuid: "nope",
              uri: "nope",
              ipv4: "999.0.0.1",
              ipv6: "nope",
              other: "anything",
            },
          },
        },
      },
    };
    expect(validateExamples(doc).map((issue) => issue.message)).toEqual([
      "must have length >= 3",
      "must have length <= 2",
      "must match pattern",
      "must match format date",
      "must match format date-time",
      "must match format email",
      "must match format uuid",
      "must match format uri",
      "must match format ipv4",
      "must match format ipv6",
    ]);
  });

  it("validates through $ref and reports unresolved refs", () => {
    const doc = {
      components: {
        schemas: {
          Target: { type: "string" },
          WithRef: {
            type: "object",
            properties: { t: { $ref: "#/components/schemas/Target" } },
            example: { t: 5 },
          },
          ExternalRef: { $ref: "other.json#/Target", example: 1 },
          MissingRef: { $ref: "#/components/schemas/Nope", example: 1 },
        },
      },
    };
    expect(validateExamples(doc).map((issue) => `${issue.pointer}: ${issue.message}`)).toEqual([
      "/components/schemas/WithRef/example/t: must be string",
      "/components/schemas/ExternalRef/example: unresolved ref",
      "/components/schemas/MissingRef/example: unresolved ref",
    ]);
  });

  it("validates parameter, requestBody and response examples", () => {
    const doc = {
      paths: {
        "/p": {
          parameters: [{ name: "a", in: "query", schema: { type: "integer" }, example: "x" }],
          get: {
            parameters: [
              {
                name: "b",
                in: "query",
                schema: { type: "string" },
                examples: { one: { value: 1 }, two: {} },
              },
            ],
            requestBody: {
              content: { "application/json": { schema: { type: "boolean" }, example: "no" } },
            },
            responses: {
              "200": {
                content: {
                  "text/plain": { schema: { type: "string" }, examples: { bad: { value: 3 } } },
                },
              },
            },
          },
        },
        "/q": true,
      },
    };
    expect(validateExamples(doc).map((issue) => `${issue.pointer}: ${issue.message}`)).toEqual([
      "/paths/~1p/parameters/0/example: must be integer",
      "/paths/~1p/get/parameters/0/examples/one/value: must be string",
      "/paths/~1p/get/requestBody/content/application~1json/example: must be boolean",
      "/paths/~1p/get/responses/200/content/text~1plain/examples/bad/value: must be string",
    ]);
  });

  it("accepts valid examples", () => {
    const doc = {
      components: {
        schemas: {
          Ok: {
            type: "object",
            required: ["kind"],
            additionalProperties: false,
            properties: {
              kind: { enum: ["a", "b"] },
              count: { const: 2 },
              when: { type: "string", format: "date-time" },
            },
            example: { kind: "a", count: 2, when: "2024-01-15T09:30:00Z" },
          },
        },
      },
    };
    expect(validateExamples(doc)).toEqual([]);
  });

  it("accepts objects that omit optional properties", () => {
    const doc = {
      components: {
        schemas: {
          Partial: {
            type: "object",
            required: ["a"],
            properties: { a: { type: "string" }, b: { type: "integer" } },
            example: { a: "x" },
          },
        },
      },
    };
    expect(validateExamples(doc)).toEqual([]);
  });

  it("skips non-object schemas and arrays without item schemas", () => {
    const doc = {
      components: { schemas: { Bad: "nope", NoItems: { type: "array", example: [1, "a"] } } },
    };
    expect(validateExamples(doc)).toEqual([]);
  });
});

describe("generateExample: remaining edge cases", () => {
  it("uses default values and flags invalid patterns", () => {
    expect(generateExample({ default: "d" })).toEqual({ ok: true, value: "d" });
    expect(generateExample({ type: "string", pattern: "[" }, { propertyName: "code" })).toEqual({
      ok: false,
      pointer: "",
      reason: "pattern",
    });
  });

  it("infers arrays from items and fails on refs without a root", () => {
    expect(generateExample({ items: { type: "boolean" } })).toEqual({ ok: true, value: [true] });
    expect(generateExample({ $ref: "#/components/schemas/Nope" })).toEqual({
      ok: false,
      pointer: "",
      reason: "unsupported",
    });
  });
});
