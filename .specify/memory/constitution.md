<!--
Sync Impact Report
==================
Version change: None → 1.0.0 (initial creation)

Modified Principles:
- N/A (initial creation)

Added Sections:
- All principles and sections (initial creation)

Removed Sections:
- N/A (initial creation)

Templates Requiring Updates:
- ✅ .specify/templates/plan-template.md - Updated with constitution check structure
- ✅ .specify/templates/spec-template.md - Aligned with constitution principles
- ✅ .specify/templates/tasks-template.md - Updated task categorization for testing discipline
- ⚠️ No command templates found (.specify/templates/commands/*.md) - skip

Follow-up TODOs:
- None (all placeholders filled)
-->

# opencode-plugin-kafka Constitution

## Core Principles

### I. Strict Initialization (NON-NEGOTIABLE)

Plugin MUST fail immediately at startup before connecting to OpenCode if configuration in `.opencode/kafka-router.json` is invalid or critical `process.env` variables are missing. No default values MUST be provided for critical configuration fields (e.g., `brokers`, `topics`, `rules`). Configuration validation MUST use Zod schemas with runtime type checking to provide clear, actionable error messages on startup failure. Rationale: Fail-fast approach prevents silent misconfigurations that could cause data loss or operational issues in production.

### II. Domain Isolation

Kafka message parsing logic MUST be independent from OpenCode integration logic. JSONPath routing logic MUST be implemented as pure functions: `(payload, rules) => matchedRule | null` with no side effects or dependencies on OpenCode APIs. This separation enables 90% of codebase to be covered by fast unit tests without mocking OpenCode runtime. Rationale: Clear boundaries between domains increase testability, maintainability, and enable independent evolution of routing logic.

### III. Resiliency (NON-NEGOTIABLE)

All errors within `eachMessage` handler MUST be caught in `try-catch` blocks. Plugin MUST NOT throw exceptions that would cause consumer to crash and restart, which would block partitions and create poison pill scenarios. On parsing errors or LLM invocation failures, errors MUST be logged with full context and messages MUST be committed to continue consumption. Optional DLQ (Dead Letter Queue) topic MAY be configured to forward failed messages. Rationale: Error resilience prevents single bad messages from disrupting entire consumer group and maintains system availability.

### IV. No-State Consumer

Plugin MUST NOT store session state or conversational context in memory. Each Kafka event MUST trigger isolated `client.sessions.create()` call, wait for completion, and then discard the session reference. No cross-message state retention is permitted. Rationale: Stateless design ensures scalability, prevents memory leaks, and simplifies debugging and restart handling.

### V. Test-First Development (NON-NEGOTIABLE)

Unit tests MUST be written before implementation for routing logic and pure functions. Integration tests MUST use `testcontainers-node` with Redpanda (not Apache Kafka) for full end-to-end validation. Unit tests MUST verify routing logic with mock payloads. Integration tests MUST verify complete flow: message ingestion → routing → OpenCode session invocation → response handling. All tests MUST run in CI/CD pipeline. Rationale: Comprehensive test coverage prevents regressions, validates design decisions early, and ensures confidence in refactoring.

## Technology Stack

**Core Technologies (NON-NEGOTIABLE)**:
- Language: TypeScript for strict type safety and runtime type inference
- Kafka Client: `kafkajs` (binary-free, works in Node/Bun/Deno runtimes)
- Configuration Validation: `zod` (runtime validation + TypeScript type generation)
- Testing Framework: `vitest` (fast test runner)
- Integration Testing: `testcontainers-node` + Redpanda (fast Kafka-compatible container)

**Configuration Requirements**:
- Config file MUST be located at `.opencode/kafka-router.json`
- Zod schema MUST define all configuration fields with no critical defaults
- JSON Schema for IDE autocomplete MAY be generated via `zod-to-json-schema` package

**Prohibited Technologies**:
- Apache Kafka (use Redpanda for testing instead - 1-2 second startup vs JVM-based Kafka)
- `librdkafka` or other binary dependencies (use kafkajs for pure JS compatibility)

## Testing Strategy

**Level A: Pure Unit Tests (Vitest)**

Test routing logic as pure functions without Kafka or OpenCode dependencies. Mock various JSON payloads and verify correct rule matching. Cover all JSONPath expressions, edge cases, and error conditions. Target: 90%+ coverage of routing and message parsing logic.

**Level B: Integration Tests (Testcontainers + Redpanda)**

Use `testcontainers-node` to spin up Redpanda container before test suite, create topics, produce test messages, and verify full plugin flow. Tests MUST mock OpenCode `client` object to verify correct API calls with expected parameters. Cleanup MUST properly stop containers after test completion. Redpanda preferred over Apache Kafka for 10-100x faster startup in CI/CD pipelines.

**Podman Configuration for Testcontainers**:

Testcontainers expects Docker socket by default. For Podman environments, configure:
```bash
systemctl --user start podman.socket
systemctl --user enable podman.socket
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
```

This MUST be configured in CI/CD environment before running integration tests.

## Governance

**Constitution Supremacy**: This constitution supersedes all coding conventions, team practices, and development decisions. Any conflict between this constitution and other documentation MUST be resolved in favor of the constitution.

**Amendment Procedure**:
1. Proposed amendments MUST be documented with rationale and impact analysis
2. Amendments MUST be reviewed and approved by project maintainers
3. Amendments MUST increment `CONSTITUTION_VERSION` according to semantic versioning:
   - MAJOR: Backward incompatible changes to principles or removal of non-negotiable requirements
   - MINOR: Addition of new principles or material expansion of existing guidance
   - PATCH: Clarifications, wording improvements, typo fixes, non-semantic refinements
4. Amendments MUST update this file's `LAST_AMENDED_DATE` to the ISO date YYYY-MM-DD
5. Migration plan MUST be provided for MAJOR or MINOR changes affecting existing code

**Compliance Review**:
- All PRs MUST be verified for constitution compliance before merge
- Automated tests MUST validate fail-fast initialization and error handling principles
- Code reviews MUST check for violations of domain isolation and no-state requirements
- Test coverage reports MUST meet 90% threshold for routing logic
- Integration tests MUST pass before release

**Complexity Justification**:
Any deviation from simplicity principles MUST be explicitly justified in implementation documentation. Violations of domain isolation or stateless design MUST include detailed rationale explaining why simpler alternatives were rejected and tradeoffs were acceptable.

**Runtime Guidance**:
For day-to-day development practices not covered by this constitution, refer to project README.md and OpenCode plugin development documentation.

**Version**: 1.0.0 | **Ratified**: 2026-04-21 | **Last Amended**: 2026-04-21
