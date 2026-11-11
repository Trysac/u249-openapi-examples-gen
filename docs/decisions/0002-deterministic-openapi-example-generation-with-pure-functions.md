# Deterministic OpenAPI example generation with pure functions

Status: accepted (generated, pending human review)

## Context

OpenAPI documents often lack examples, and hand-written examples drift from schemas. Random fake-data generators produce non-deterministic outputs, making diffs noisy.

## Decision

Implement a pure TypeScript library that deterministically fills missing examples using schema constraints, formats, property-name heuristics, and local $ref resolution. Validation runs against a subset validator and reports RFC6901 pointers.

## Consequences

The library is side-effect free, returns cloned documents from fillExamples, and enforces limits (10MB input, 100k nodes, depth 32). CLI exits with stable codes. No runtime dependencies.
