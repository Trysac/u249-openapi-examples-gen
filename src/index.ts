/**
 * Public API of @trysac/openapi-examples-gen.
 *
 * Deterministically fills and validates examples in OpenAPI 3.x JSON documents.
 */

/**
 * Reason codes for a failed example generation.
 */
export type GenerationFailureReason =
  | "pattern"
  | "cyclic_required"
  | "too_deep"
  | "unsupported"
  | "too_many_items";

/**
 * Result of {@link generateExample}.
 */
export type GenerateExampleResult =
  | { ok: true; value: unknown }
  | { ok: false; pointer: string; reason: GenerationFailureReason };

/**
 * Options for {@link generateExample}.
 */
export interface GenerateExampleOptions {
  /** Root document used to resolve local `$ref` JSON pointers. */
  root?: object;
  /** Property name used for name-based string heuristics. */
  propertyName?: string;
  /** Maximum schema nesting depth (default 32). */
  maxDepth?: number;
}

/**
 * Base error class with a stable, machine-readable code.
 */
export class ExamplesError extends Error {
  public readonly code: "input_too_large" | "invalid_json" | "invalid_document" | "unresolved_ref";

  public constructor(code: ExamplesError["code"], message: string) {
    super(message);
    this.name = "ExamplesError";
    this.code = code;
  }
}

/**
 * Options for {@link fillExamples}.
 */
export interface FillExamplesOptions {
  /** Replace existing `example` keys (default false). */
  overwrite?: boolean;
}

/**
 * Result of {@link fillExamples}.
 */
export interface FillExamplesResult {
  document: object;
  added: string[];
  skipped: { pointer: string; reason: string }[];
}

/**
 * Validation issue reported by {@link validateExamples}.
 */
export interface ValidationIssue {
  pointer: string;
  message: string;
}

/**
 * Known string formats and their fixed example values.
 */
const FORMAT_EXAMPLES: Record<string, string> = {
  "date-time": "2024-01-15T09:30:00Z",
  date: "2024-01-15",
  email: "user@example.com",
  uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  uri: "https://example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
};

/**
 * Property name heuristics (normalized: lowercase, `_` and `-` removed).
 */
const PROPERTY_NAME_EXAMPLES: Record<string, string> = {
  name: "Jane Doe",
  firstname: "Jane",
  lastname: "Doe",
  email: "user@example.com",
  phone: "+1-202-555-0143",
  city: "Springfield",
  country: "US",
  currency: "USD",
  url: "https://example.com",
  title: "Example title",
  description: "A short description.",
  status: "active",
};

const MAX_PROPERTIES = 50;
const MAX_SCHEMA_NODES = 100_000;
const DEFAULT_MAX_DEPTH = 32;

const OPERATION_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

interface InternalContext {
  root: object | undefined;
  propertyName: string | undefined;
  maxDepth: number;
  depth: number;
  stack: Set<object>;
  nodes: { count: number };
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveJsonPointer(root: object | undefined, pointer: string): unknown {
  if (!root || !pointer.startsWith("/")) {
    return undefined;
  }
  const segments = pointer.split("/").slice(1).map(unescapePointerSegment);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.hasOwn(bObj, key)) {
      return false;
    }
    if (!deepEqual(aObj[key], bObj[key])) {
      return false;
    }
  }
  return true;
}

function isMultipleOf(value: number, multipleOf: number): boolean {
  if (multipleOf === 0) {
    return value === 0;
  }
  const quotient = value / multipleOf;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function smallestMultipleAtLeast(base: number, multiple: number): number {
  return Math.ceil(base / multiple - 1e-12) * multiple;
}

function matchesPattern(pattern: string | undefined, value: string): boolean {
  if (!pattern) {
    return true;
  }
  try {
    const regex = new RegExp(pattern, "u");
    return regex.test(value);
  } catch {
    return false;
  }
}

function generateString(
  schema: Record<string, unknown>,
  propertyName: string | undefined,
): GenerateExampleResult {
  let value: string;
  const formatted = typeof schema.format === "string" ? FORMAT_EXAMPLES[schema.format] : undefined;
  if (formatted !== undefined) {
    value = formatted;
  } else if (propertyName) {
    const normalized = propertyName.toLowerCase().replace(/[-_]/g, "");
    value = PROPERTY_NAME_EXAMPLES[normalized] ?? "string";
  } else {
    value = "string";
  }

  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    value = value.padEnd(schema.minLength, "x");
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    value = value.slice(0, schema.maxLength);
  }

  if (!matchesPattern(typeof schema.pattern === "string" ? schema.pattern : undefined, value)) {
    return { ok: false, pointer: "", reason: "pattern" };
  }

  return { ok: true, value };
}

function generateNumber(schema: Record<string, unknown>, integer: boolean): GenerateExampleResult {
  let minimum: number | undefined;
  let exclusiveMinimum: boolean = false;
  let maximum: number | undefined;
  let exclusiveMaximum: boolean = false;

  if (typeof schema.minimum === "number") {
    minimum = schema.minimum;
    if (schema.exclusiveMinimum === true) {
      exclusiveMinimum = true;
    }
  }
  if (typeof schema.exclusiveMinimum === "number" && schema.exclusiveMinimum !== undefined) {
    minimum = schema.exclusiveMinimum;
    exclusiveMinimum = true;
  }

  if (typeof schema.maximum === "number") {
    maximum = schema.maximum;
    if (schema.exclusiveMaximum === true) {
      exclusiveMaximum = true;
    }
  }
  if (typeof schema.exclusiveMaximum === "number" && schema.exclusiveMaximum !== undefined) {
    maximum = schema.exclusiveMaximum;
    exclusiveMaximum = true;
  }

  let base = integer ? 1 : 1.5;
  if (minimum !== undefined) {
    if (exclusiveMinimum) {
      base = minimum + (integer ? 1 : 0.1);
    } else {
      base = minimum;
    }
  }

  const candidate =
    typeof schema.multipleOf === "number" ? smallestMultipleAtLeast(base, schema.multipleOf) : base;

  if (maximum !== undefined) {
    const tooBig = exclusiveMaximum ? candidate >= maximum : candidate > maximum;
    if (tooBig) {
      return { ok: false, pointer: "", reason: "unsupported" };
    }
  }

  return { ok: true, value: candidate };
}

function dereferenceSchemaObject(
  schema: Record<string, unknown>,
  root: object | undefined,
): Record<string, unknown> | undefined {
  let current: Record<string, unknown> = schema;
  const seen = new Set<object>();
  while (typeof current.$ref === "string") {
    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);
    const ref = current.$ref;
    if (!ref.startsWith("#/")) {
      return undefined;
    }
    const target = resolveJsonPointer(root, ref.slice(1));
    if (
      target === undefined ||
      target === null ||
      typeof target !== "object" ||
      Array.isArray(target)
    ) {
      return undefined;
    }
    current = target as Record<string, unknown>;
  }
  return current;
}

function generateCombinedSchema(
  schema: Record<string, unknown>,
  ctx: InternalContext,
): GenerateExampleResult | undefined {
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const properties: Record<string, unknown> = {};
    if (
      schema.properties !== null &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
    ) {
      Object.assign(properties, schema.properties as Record<string, unknown>);
    }
    const required: string[] = Array.isArray(schema.required)
      ? (schema.required as string[]).filter((prop) => typeof prop === "string")
      : [];
    let sawObject = Object.keys(properties).length > 0;

    for (const branch of schema.allOf) {
      if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
        continue;
      }
      const resolved = dereferenceSchemaObject(branch as Record<string, unknown>, ctx.root);
      if (!resolved) {
        continue;
      }
      if (
        resolved.properties !== null &&
        typeof resolved.properties === "object" &&
        !Array.isArray(resolved.properties)
      ) {
        Object.assign(properties, resolved.properties as Record<string, unknown>);
        sawObject = true;
      }
      if (Array.isArray(resolved.required)) {
        for (const prop of resolved.required) {
          if (typeof prop === "string") {
            required.push(prop);
          }
        }
      }
    }

    const merged: Record<string, unknown> = { ...schema };
    delete merged.allOf;
    if (Object.keys(properties).length > 0) {
      merged.properties = properties;
    }
    if (required.length > 0) {
      merged.required = required;
    }
    if (merged.type === undefined && sawObject) {
      merged.type = "object";
    }
    return generateFromSchema(merged, ctx);
  }

  let branches: unknown[] | undefined;
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    branches = schema.oneOf;
  } else if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    branches = schema.anyOf;
  }
  if (branches) {
    const first = branches[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) {
      return { ok: false, pointer: "", reason: "unsupported" };
    }
    return generateFromSchema(first as Record<string, unknown>, {
      ...ctx,
      depth: ctx.depth + 1,
    });
  }

  return undefined;
}

function generateFromSchema(
  schema: Record<string, unknown>,
  ctx: InternalContext,
): GenerateExampleResult {
  ctx.nodes.count += 1;
  if (ctx.nodes.count > MAX_SCHEMA_NODES) {
    return { ok: false, pointer: "", reason: "unsupported" };
  }
  if (ctx.depth > ctx.maxDepth) {
    return { ok: false, pointer: "", reason: "too_deep" };
  }
  if (ctx.stack.has(schema)) {
    return { ok: false, pointer: "", reason: "cyclic_required" };
  }
  ctx.stack.add(schema);
  try {
    return generateSchemaValue(schema, ctx);
  } finally {
    ctx.stack.delete(schema);
  }
}

function generateSchemaValue(
  schema: Record<string, unknown>,
  ctx: InternalContext,
): GenerateExampleResult {
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (!ref.startsWith("#/")) {
      return { ok: false, pointer: "", reason: "unsupported" };
    }
    const target = resolveJsonPointer(ctx.root, ref.slice(1));
    if (
      target === undefined ||
      target === null ||
      typeof target !== "object" ||
      Array.isArray(target)
    ) {
      return { ok: false, pointer: "", reason: "unsupported" };
    }
    const nextCtx: InternalContext = {
      ...ctx,
      depth: ctx.depth + 1,
    };
    return generateFromSchema(target as Record<string, unknown>, nextCtx);
  }

  if ("const" in schema) {
    return { ok: true, value: schema.const };
  }

  if ("example" in schema) {
    return { ok: true, value: schema.example };
  }

  if ("default" in schema) {
    return { ok: true, value: schema.default };
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return { ok: true, value: schema.enum[0] };
  }

  const combined = generateCombinedSchema(schema, ctx);
  if (combined !== undefined) {
    return combined;
  }

  const type = schema.type;
  let effectiveType: string | undefined;
  if (typeof type === "string") {
    effectiveType = type;
  } else if (Array.isArray(type)) {
    effectiveType = type.find((t) => t !== "null") ?? "null";
  } else if (schema.nullable === true && type === undefined) {
    effectiveType = "string";
  }

  if (effectiveType === undefined) {
    if (typeof schema.properties === "object" && schema.properties !== null) {
      effectiveType = "object";
    } else if (schema.items !== undefined) {
      effectiveType = "array";
    } else {
      effectiveType = "string";
    }
  }

  switch (effectiveType) {
    case "string":
      return generateString(schema, ctx.propertyName);
    case "integer":
      return generateNumber(schema, true);
    case "number":
      return generateNumber(schema, false);
    case "boolean":
      return { ok: true, value: true };
    case "null":
      return { ok: true, value: null };
    case "array": {
      const minItems = typeof schema.minItems === "number" ? schema.minItems : undefined;
      const maxItems = typeof schema.maxItems === "number" ? schema.maxItems : undefined;
      const uniqueItems = schema.uniqueItems === true;
      const count = minItems !== undefined ? Math.max(1, minItems) : 1;

      if (count > 10) {
        return { ok: false, pointer: "", reason: "too_many_items" };
      }
      if (maxItems !== undefined && count > maxItems) {
        return { ok: false, pointer: "", reason: "unsupported" };
      }
      if (uniqueItems && count > 1) {
        return { ok: false, pointer: "", reason: "unsupported" };
      }

      const itemSchema =
        schema.items !== undefined ? (schema.items as Record<string, unknown>) : { type: "string" };
      const result: unknown[] = [];
      for (let i = 0; i < count; i += 1) {
        const itemResult = generateFromSchema(itemSchema, {
          ...ctx,
          depth: ctx.depth + 1,
          propertyName: undefined,
        });
        if (!itemResult.ok) {
          return {
            ok: false,
            pointer: `/${i}${itemResult.pointer}`,
            reason: itemResult.reason,
          };
        }
        result.push(itemResult.value);
      }
      return { ok: true, value: result };
    }
    case "object": {
      const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
      const propertyKeys = Object.keys(properties);
      if (propertyKeys.length > MAX_PROPERTIES) {
        return { ok: false, pointer: "", reason: "unsupported" };
      }

      const obj: Record<string, unknown> = {};
      for (const prop of propertyKeys) {
        const propSchema = properties[prop] as Record<string, unknown>;
        const propResult = generateFromSchema(propSchema, {
          ...ctx,
          depth: ctx.depth + 1,
          propertyName: prop,
        });
        if (!propResult.ok) {
          if (required.includes(prop)) {
            return {
              ok: false,
              pointer: `/${escapePointerSegment(prop)}${propResult.pointer}`,
              reason: propResult.reason,
            };
          }
          // optional property omitted
          continue;
        }
        obj[prop] = propResult.value;
      }
      return { ok: true, value: obj };
    }
    default:
      return { ok: false, pointer: "", reason: "unsupported" };
  }
}

/**
 * Generates a deterministic example for the given OpenAPI schema.
 *
 * @param schema - OpenAPI schema object (JSON).
 * @param opts - Optional root document, property name, and max depth.
 * @returns Either a value or a structured failure.
 */
export function generateExample(
  schema: object,
  opts: GenerateExampleOptions = {},
): GenerateExampleResult {
  const ctx: InternalContext = {
    root: opts.root,
    propertyName: opts.propertyName,
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    depth: 0,
    stack: new Set(),
    nodes: { count: 0 },
  };
  return generateFromSchema(schema as Record<string, unknown>, ctx);
}

function cloneDocument<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc)) as T;
}

function hasExamples(
  obj: Record<string, unknown> | undefined,
  checkExamplesObject: boolean,
): boolean {
  if (!obj) {
    return false;
  }
  if ("example" in obj) {
    return true;
  }
  if (checkExamplesObject && "examples" in obj) {
    const examples = obj.examples;
    return typeof examples === "object" && examples !== null && Object.keys(examples).length > 0;
  }
  return false;
}

function processTarget(
  target: Record<string, unknown>,
  schema: Record<string, unknown>,
  pointer: string,
  doc: object,
  opts: FillExamplesOptions,
  added: string[],
  skipped: { pointer: string; reason: string }[],
  checkExamplesObject: boolean,
): void {
  const alreadyHasExample = "example" in target;
  const alreadyHasExamples =
    checkExamplesObject && hasExamples(target, true) && "examples" in target;

  if (alreadyHasExamples) {
    skipped.push({ pointer, reason: "already has examples" });
    return;
  }
  if (alreadyHasExample && !opts.overwrite) {
    skipped.push({ pointer, reason: "already has example" });
    return;
  }

  const result = generateExample(schema, {
    root: doc,
  });

  if (!result.ok) {
    skipped.push({ pointer, reason: result.reason });
    return;
  }

  target.example = result.value;
  added.push(pointer);
}

/**
 * Fills missing examples in an OpenAPI document, returning a new deep copy.
 *
 * @param doc - OpenAPI document object.
 * @param opts - Overwrite behavior.
 * @returns The filled document, added pointers, and skipped pointers.
 */
export function fillExamples(doc: object, opts: FillExamplesOptions = {}): FillExamplesResult {
  const clone = cloneDocument(doc);
  const added: string[] = [];
  const skipped: { pointer: string; reason: string }[] = [];
  const overwrite = opts.overwrite ?? false;

  // components.schemas.*
  const schemas = (clone as { components?: { schemas?: Record<string, unknown> } }).components
    ?.schemas;
  if (schemas && typeof schemas === "object") {
    for (const key of Object.keys(schemas)) {
      const schema = schemas[key];
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        continue;
      }
      const pointer = `/components/schemas/${escapePointerSegment(key)}/example`;
      processTarget(
        schema as Record<string, unknown>,
        schema as Record<string, unknown>,
        pointer,
        clone,
        { overwrite },
        added,
        skipped,
        false,
      );
    }
  }

  // paths
  const paths = (clone as { paths?: Record<string, unknown> }).paths;
  if (paths && typeof paths === "object") {
    for (const pathKey of Object.keys(paths)) {
      const pathItem = paths[pathKey] as Record<string, unknown> | undefined;
      if (!pathItem || typeof pathItem !== "object") {
        continue;
      }
      const pathPointer = `/paths/${escapePointerSegment(pathKey)}`;

      // path-level parameters
      if (Array.isArray(pathItem.parameters)) {
        pathItem.parameters.forEach((param: unknown, idx: number) => {
          const p = param as Record<string, unknown>;
          if (p && typeof p === "object" && p.schema && typeof p.schema === "object") {
            const pointer = `${pathPointer}/parameters/${idx}/example`;
            processTarget(
              p,
              p.schema as Record<string, unknown>,
              pointer,
              clone,
              { overwrite },
              added,
              skipped,
              true,
            );
          }
        });
      }

      for (const method of OPERATION_METHODS) {
        const operation = pathItem[method] as Record<string, unknown> | undefined;
        if (!operation || typeof operation !== "object") {
          continue;
        }
        const opPointer = `${pathPointer}/${method}`;

        // operation parameters
        if (Array.isArray(operation.parameters)) {
          operation.parameters.forEach((param: unknown, idx: number) => {
            const p = param as Record<string, unknown>;
            if (p && typeof p === "object" && p.schema && typeof p.schema === "object") {
              const pointer = `${opPointer}/parameters/${idx}/example`;
              processTarget(
                p,
                p.schema as Record<string, unknown>,
                pointer,
                clone,
                { overwrite },
                added,
                skipped,
                true,
              );
            }
          });
        }

        // requestBody
        const requestBody = operation.requestBody as Record<string, unknown> | undefined;
        if (requestBody?.content && typeof requestBody.content === "object") {
          const content = requestBody.content as Record<string, unknown>;
          for (const mediaTypeKey of Object.keys(content)) {
            const mediaType = content[mediaTypeKey] as Record<string, unknown>;
            if (mediaType?.schema && typeof mediaType.schema === "object") {
              const pointer = `${opPointer}/requestBody/content/${escapePointerSegment(mediaTypeKey)}/example`;
              processTarget(
                mediaType,
                mediaType.schema as Record<string, unknown>,
                pointer,
                clone,
                { overwrite },
                added,
                skipped,
                true,
              );
            }
          }
        }

        // responses
        const responses = operation.responses as Record<string, unknown> | undefined;
        if (responses && typeof responses === "object") {
          for (const statusKey of Object.keys(responses)) {
            const response = responses[statusKey] as Record<string, unknown>;
            if (response?.content && typeof response.content === "object") {
              const content = response.content as Record<string, unknown>;
              for (const mediaTypeKey of Object.keys(content)) {
                const mediaType = content[mediaTypeKey] as Record<string, unknown>;
                if (mediaType?.schema && typeof mediaType.schema === "object") {
                  const pointer = `${opPointer}/responses/${escapePointerSegment(statusKey)}/content/${escapePointerSegment(mediaTypeKey)}/example`;
                  processTarget(
                    mediaType,
                    mediaType.schema as Record<string, unknown>,
                    pointer,
                    clone,
                    { overwrite },
                    added,
                    skipped,
                    true,
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  return { document: clone, added, skipped };
}

function isOfType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return Number.isInteger(value);
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function validateFormat(format: string, value: string): boolean {
  switch (format) {
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "date-time":
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value);
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case "uuid":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      );
    case "uri":
      return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
    case "ipv4":
      return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(
        value,
      );
    case "ipv6":
      return /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])\d)\.){3}(25[0-5]|(2[0-4]|1?[0-9])\d)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])\d)\.){3}(25[0-5]|(2[0-4]|1?[0-9])\d))$/.test(
        value,
      );
    default:
      return true;
  }
}

function validateValue(
  value: unknown,
  schema: Record<string, unknown>,
  pointer: string,
  root: object,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (!ref.startsWith("#/")) {
      issues.push({ pointer, message: "unresolved ref" });
      return issues;
    }
    const target = resolveJsonPointer(root, ref.slice(1));
    if (
      target === undefined ||
      target === null ||
      typeof target !== "object" ||
      Array.isArray(target)
    ) {
      issues.push({ pointer, message: "unresolved ref" });
      return issues;
    }
    return validateValue(value, target as Record<string, unknown>, pointer, root);
  }

  const type = schema.type;
  if (type !== undefined) {
    const allowedTypes = Array.isArray(type) ? type : [type];
    const nullable = schema.nullable === true && value === null;
    let typeOk = nullable;
    if (!typeOk) {
      for (const t of allowedTypes) {
        if (isOfType(value, t)) {
          typeOk = true;
          break;
        }
      }
    }
    if (!typeOk) {
      const typeStr = Array.isArray(type) ? type.join("|") : type;
      issues.push({ pointer, message: `must be ${typeStr}` });
    }
  }

  if ("const" in schema && !deepEqual(value, schema.const)) {
    issues.push({ pointer, message: "must equal const" });
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => deepEqual(value, item))) {
    issues.push({ pointer, message: "must be one of the enum values" });
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const valueObj = value as Record<string, unknown>;
    const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

    for (const prop of required) {
      if (!(prop in valueObj)) {
        issues.push({
          pointer: `${pointer}/${escapePointerSegment(prop)}`,
          message: "is required",
        });
      }
    }

    for (const prop of Object.keys(properties)) {
      if (prop in valueObj) {
        issues.push(
          ...validateValue(
            valueObj[prop],
            properties[prop] as Record<string, unknown>,
            `${pointer}/${escapePointerSegment(prop)}`,
            root,
          ),
        );
      }
    }

    if (schema.additionalProperties === false) {
      for (const prop of Object.keys(valueObj)) {
        if (!(prop in properties)) {
          issues.push({
            pointer: `${pointer}/${escapePointerSegment(prop)}`,
            message: "must not have additional properties",
          });
        }
      }
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    const itemSchema = schema.items as Record<string, unknown>;
    value.forEach((item, idx) => {
      issues.push(...validateValue(item, itemSchema, `${pointer}/${idx}`, root));
    });
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number") {
      if (schema.exclusiveMinimum === true) {
        if (value <= schema.minimum) {
          issues.push({
            pointer,
            message: `must be > ${schema.minimum}`,
          });
        }
      } else if (value < schema.minimum) {
        issues.push({
          pointer,
          message: `must be >= ${schema.minimum}`,
        });
      }
    }
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      issues.push({
        pointer,
        message: `must be > ${schema.exclusiveMinimum}`,
      });
    }
    if (typeof schema.maximum === "number") {
      if (schema.exclusiveMaximum === true) {
        if (value >= schema.maximum) {
          issues.push({
            pointer,
            message: `must be < ${schema.maximum}`,
          });
        }
      } else if (value > schema.maximum) {
        issues.push({
          pointer,
          message: `must be <= ${schema.maximum}`,
        });
      }
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      issues.push({
        pointer,
        message: `must be < ${schema.exclusiveMaximum}`,
      });
    }
    if (typeof schema.multipleOf === "number" && !isMultipleOf(value, schema.multipleOf)) {
      issues.push({
        pointer,
        message: `must be multiple of ${schema.multipleOf}`,
      });
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      issues.push({
        pointer,
        message: `must have length >= ${schema.minLength}`,
      });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      issues.push({
        pointer,
        message: `must have length <= ${schema.maxLength}`,
      });
    }
    if (typeof schema.pattern === "string" && !matchesPattern(schema.pattern, value)) {
      issues.push({ pointer, message: "must match pattern" });
    }
    if (
      typeof schema.format === "string" &&
      schema.format in FORMAT_EXAMPLES &&
      !validateFormat(schema.format, value)
    ) {
      issues.push({
        pointer,
        message: `must match format ${schema.format}`,
      });
    }
  }

  return issues;
}

function validateParameterOrMediaTypeExamples(
  obj: Record<string, unknown>,
  schema: Record<string, unknown>,
  basePointer: string,
  root: object,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if ("example" in obj) {
    issues.push(...validateValue(obj.example, schema, `${basePointer}/example`, root));
  }
  if ("examples" in obj && typeof obj.examples === "object" && obj.examples !== null) {
    const examples = obj.examples as Record<string, unknown>;
    for (const key of Object.keys(examples)) {
      const entry = examples[key] as Record<string, unknown>;
      if ("value" in entry) {
        issues.push(
          ...validateValue(
            entry.value,
            schema,
            `${basePointer}/examples/${escapePointerSegment(key)}/value`,
            root,
          ),
        );
      }
    }
  }
  return issues;
}

/**
 * Validates all `example` and `examples[].value` values in an OpenAPI document.
 *
 * @param doc - OpenAPI document object.
 * @returns Array of issues with pointer and message.
 */
export function validateExamples(doc: object): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // components.schemas.*
  const schemas = (doc as { components?: { schemas?: Record<string, unknown> } }).components
    ?.schemas;
  if (schemas && typeof schemas === "object") {
    for (const key of Object.keys(schemas)) {
      const schema = schemas[key];
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        continue;
      }
      if ("example" in schema) {
        issues.push(
          ...validateValue(
            schema.example,
            schema as Record<string, unknown>,
            `/components/schemas/${escapePointerSegment(key)}/example`,
            doc,
          ),
        );
      }
    }
  }

  // paths
  const paths = (doc as { paths?: Record<string, unknown> }).paths;
  if (paths && typeof paths === "object") {
    for (const pathKey of Object.keys(paths)) {
      const pathItem = paths[pathKey] as Record<string, unknown> | undefined;
      if (!pathItem || typeof pathItem !== "object") {
        continue;
      }
      const pathPointer = `/paths/${escapePointerSegment(pathKey)}`;

      // path-level parameters
      if (Array.isArray(pathItem.parameters)) {
        pathItem.parameters.forEach((param: unknown, idx: number) => {
          const p = param as Record<string, unknown>;
          if (p?.schema && typeof p.schema === "object") {
            issues.push(
              ...validateParameterOrMediaTypeExamples(
                p,
                p.schema as Record<string, unknown>,
                `${pathPointer}/parameters/${idx}`,
                doc,
              ),
            );
          }
        });
      }

      for (const method of OPERATION_METHODS) {
        const operation = pathItem[method] as Record<string, unknown> | undefined;
        if (!operation || typeof operation !== "object") {
          continue;
        }
        const opPointer = `${pathPointer}/${method}`;

        // parameters
        if (Array.isArray(operation.parameters)) {
          operation.parameters.forEach((param: unknown, idx: number) => {
            const p = param as Record<string, unknown>;
            if (p?.schema && typeof p.schema === "object") {
              issues.push(
                ...validateParameterOrMediaTypeExamples(
                  p,
                  p.schema as Record<string, unknown>,
                  `${opPointer}/parameters/${idx}`,
                  doc,
                ),
              );
            }
          });
        }

        // requestBody
        const requestBody = operation.requestBody as Record<string, unknown> | undefined;
        if (requestBody?.content && typeof requestBody.content === "object") {
          const content = requestBody.content as Record<string, unknown>;
          for (const mediaTypeKey of Object.keys(content)) {
            const mediaType = content[mediaTypeKey] as Record<string, unknown>;
            if (mediaType?.schema && typeof mediaType.schema === "object") {
              issues.push(
                ...validateParameterOrMediaTypeExamples(
                  mediaType,
                  mediaType.schema as Record<string, unknown>,
                  `${opPointer}/requestBody/content/${escapePointerSegment(mediaTypeKey)}`,
                  doc,
                ),
              );
            }
          }
        }

        // responses
        const responses = operation.responses as Record<string, unknown> | undefined;
        if (responses && typeof responses === "object") {
          for (const statusKey of Object.keys(responses)) {
            const response = responses[statusKey] as Record<string, unknown>;
            if (response?.content && typeof response.content === "object") {
              const content = response.content as Record<string, unknown>;
              for (const mediaTypeKey of Object.keys(content)) {
                const mediaType = content[mediaTypeKey] as Record<string, unknown>;
                if (mediaType?.schema && typeof mediaType.schema === "object") {
                  issues.push(
                    ...validateParameterOrMediaTypeExamples(
                      mediaType,
                      mediaType.schema as Record<string, unknown>,
                      `${opPointer}/responses/${escapePointerSegment(statusKey)}/content/${escapePointerSegment(mediaTypeKey)}`,
                      doc,
                    ),
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  return issues;
}
