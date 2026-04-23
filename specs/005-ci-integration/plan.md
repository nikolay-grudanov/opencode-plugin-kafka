# Implementation Plan: CI/CD Pipeline and Integration Tests

**Branch**: `005-ci-integration` | **Date**: 2026-04-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-ci-integration/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

This feature implements automated CI/CD validation and integration tests for the opencode-plugin-kafka project. The primary requirements are:

1. **Automated Code Quality Checks** (FR-001, FR-002, FR-003): GitHub Actions workflow that validates code changes through lint → type check → unit tests → build on every push to main and pull request.

2. **Integration Tests with Real Message Broker** (FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010): Comprehensive integration tests using testcontainers-node with Redpanda to validate end-to-end message processing, sequential ordering, error handling, and graceful shutdown.

3. **Developer Documentation** (FR-011): Clear documentation for running integration tests in different environments (Docker, Podman on Linux/macOS).

Technical approach: Use GitHub Actions for CI/CD with sequential pipeline steps. Use testcontainers-node with Redpanda for integration tests, supporting both Docker and Podman runtimes. Create separate vitest configuration for integration tests to keep them opt-in (not running in CI during this phase).

## Technical Context

**Language/Version**: TypeScript 6.x (ES2022 target, ESNext modules, `moduleResolution: bundler`)  
**Primary Dependencies**: kafkajs (Kafka client), zod (runtime validation), vitest (testing), testcontainers-node (integration testing), Redpanda (Kafka-compatible message broker)  
**Storage**: N/A (Kafka-based message queue, no local persistence)  
**Testing**: vitest (unit + integration tests), testcontainers-node + Redpanda (integration tests)  
**Target Platform**: Linux (CI environment), Linux/macOS (local development)  
**Project Type**: Library (OpenCode plugin)  
**Performance Goals**: Integration tests start message broker and complete within 2 minutes (SC-003)  
**Constraints**: Consumer shutdown within 15 seconds (SC-008), no session state between messages (Constitution IV), 90%+ coverage for routing logic (Constitution V)  
**Scale/Scope**: Developer tool, integration tests for consumer.ts, CI/CD pipeline for automated validation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I: Strict Initialization (NON-NEGOTIABLE)
- ✅ **Pass**: This feature does not modify existing initialization logic. All new configuration (CI/CD pipeline, test containers) has clear validation and failure modes.

### Principle II: Domain Isolation
- ✅ **Pass**: Integration tests validate domain isolation by testing message parsing logic independently from OpenCode integration. The tests mock OpenCode client.sessions.create() to verify correct API calls without actual LLM invocations.

### Principle III: Resiliency (NON-NEGOTIABLE)
- ✅ **Pass**: Integration tests include scenarios for error handling (FR-007, FR-008, FR-009) and graceful shutdown (FR-010). Tests verify that the consumer does not crash on invalid messages and handles errors with try-catch blocks.

### Principle IV: No-State Consumer
- ✅ **Pass**: Integration tests validate no-state consumer behavior by ensuring each message triggers an isolated client.sessions.create() call and that no cross-message state is retained.

### Principle V: Test-First Development (NON-NEGOTIABLE)
- ✅ **Pass**: This feature implements comprehensive integration tests using testcontainers-node with Redpanda, covering all 5 scenarios from Stage 2 DoD. Tests are written before any implementation modifications (though this phase only adds tests, no source code changes).

**Overall Status**: ✅ **PASS** - All constitution principles are satisfied. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/005-ci-integration/
├── spec.md              # Feature specification
├── plan.md              # This file (implementation plan)
├── research.md          # Phase 0 output (research findings)
├── data-model.md        # Phase 1 output (data entities)
├── quickstart.md        # Phase 1 output (developer quickstart)
├── contracts/           # Phase 1 output (interface contracts - N/A for this feature)
├── checklists/
│   └── requirements.md  # Specification quality checklist
└── tasks.md             # Phase 2 output (tasks - NOT created by /speckit.plan)
```

### Source Code (repository root)

This feature adds new files without modifying existing source code:

```text
.github/
└── workflows/
    └── ci.yml                           # GitHub Actions CI/CD pipeline

specs/005-ci-integration/
└── [documentation files as above]

tests/integration/
└── consumer.integration.test.ts         # Integration tests for consumer.ts

vitest.integration.config.ts             # Separate vitest config for integration tests

.testcontainers.properties               # Testcontainers configuration for Podman

DEVELOPMENT.md                           # Developer documentation (create or update)
```

**Structure Decision**: This feature adds CI/CD configuration, integration test infrastructure, and developer documentation. No changes to existing source files in `src/` are made, maintaining separation between existing code and new validation infrastructure. The integration test file follows the existing `tests/` directory structure.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. This section is not applicable.
