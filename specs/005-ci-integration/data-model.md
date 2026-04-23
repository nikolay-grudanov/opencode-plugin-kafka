# Data Model: CI/CD Pipeline and Integration Tests

**Feature**: CI/CD Pipeline and Integration Tests  
**Date**: 2026-04-23  
**Phase**: 1 - Design & Contracts

## Overview

This document describes the data entities and structures involved in the CI/CD pipeline and integration tests infrastructure. While this feature primarily adds infrastructure rather than data persistence, it introduces several entities that represent the validation and testing environment.

## Entities

### CI Workflow

Represents the automated validation pipeline that executes on code changes.

**Attributes**:
- `name`: "CI" (fixed workflow name)
- `triggers`: Events that initiate the workflow
  - `push.branches`: ["main"] - Runs on every push to main
  - `pull_request.branches`: ["main"] - Runs on every PR targeting main
- `concurrency`: Configuration for managing concurrent runs
  - `group`: `${{ github.workflow }}-${{ github.ref }}` - Unique group per workflow and ref
  - `cancel-in-progress`: true - Cancels outdated runs
- `job.name`: "ci" (single job)
- `job.runs-on`: "ubuntu-latest" (runner environment)
- `steps`: Sequential validation steps
  1. `checkout`: Fetch repository code
  2. `setup-node`: Node.js 20 with npm cache
  3. `npm ci`: Install dependencies
  4. `lint`: Run ESLint
  5. `typecheck`: Run TypeScript compiler (no emit)
  6. `test`: Run unit tests (Vitest)
  7. `build`: Compile TypeScript

**Validation Rules**:
- Each step must pass before the next step executes
- If any step fails, the pipeline stops and reports failure
- All steps must run on the same runner (sequential, not parallel)
- Pipeline must complete within GitHub Actions timeout limits

---

### Test Container

Represents the Redpanda container instance used for integration testing.

**Attributes**:
- `type`: "RedpandaContainer" (from @testcontainers/kafka)
- `lifecycle`: Suite-level (starts once per test suite)
  - `beforeAll.timeout`: 60000ms - Container startup timeout
  - `afterAll.timeout`: 30000ms - Container shutdown timeout
- `brokers`: string[] - Array of broker URLs (e.g., ["localhost:9092"])
- `status`: "starting" | "running" | "stopped"

**Behavior**:
- `start()`: Spins up Redpanda container, returns broker connection string
- `stop()`: Gracefully stops container and releases resources
- `getBootstrapServers()`: Returns broker URL for Kafka client configuration

**Validation Rules**:
- Container must be fully started before any test executes
- Container must be stopped after all tests complete
- Container failure during startup should fail the test suite with clear error message
- Resources must be properly cleaned up to prevent leaks

---

### Test Environment Configuration

Represents the environment variables and configuration needed for integration tests.

**Attributes**:
- `KAFKA_BROKERS`: string (comma-separated broker URLs)
- `KAFKA_GROUP_ID`: string (unique per test to avoid offset conflicts)
- `KAFKA_CLIENT_ID`: string (e.g., "test-client")
- `KAFKA_DLQ_TOPIC`: string (e.g., "test-dlq")
- `KAFKA_TOPICS`: string (comma-separated topic list)
- `KAFKA_SSL`: string ("false" for local testing)

**Helper Function**: `buildTestEnv(brokers, overrides?)`
- Input: 
  - `brokers`: string[] - Container broker URLs
  - `overrides`: Partial<TestEnv> - Optional overrides for specific env vars
- Output: TestEnv object with all required env vars
- Behavior: Generates unique groupId per test, sets defaults for other vars

**Validation Rules**:
- Each test must have a unique groupId to prevent offset conflicts
- Environment must be restored to original state after each test
- Invalid env configuration should cause test to fail early

---

### Test Scenario

Represents a single integration test scenario with setup, action, and assertions.

**Scenario 1: Sequential Processing**
- `setup`: Create topic, produce 3 valid JSON messages
- `action`: Start consumer, wait for all messages to process
- `assertions`:
  - Messages processed in order (1 before 2 before 3)
  - Message N+1 starts only after message N completes
- `priority`: P1 (DoD requirement)

**Scenario 2: Invalid JSON Goes to DLQ**
- `setup`: Produce 1 message with invalid JSON value
- `action`: Start consumer
- `assertions`:
  - Consumer does not crash
  - Original message appears in DLQ topic
  - DLQ message is valid JSON with errorMessage field
- `priority`: P2

**Scenario 3: No Matching Rule - Message Skipped**
- `setup`: Configure non-matching rule, produce 1 message
- `action`: Start consumer
- `assertions`:
  - Consumer does not crash
  - DLQ is empty (message not sent to DLQ)
  - Offset committed (consumer moved past message)
- `priority`: P2

**Scenario 4: Message Exceeds Size Limit**
- `setup`: Produce 1 message > 1MB
- `action`: Start consumer
- `assertions`:
  - Oversized message sent to DLQ with error message containing "size" or "limit"
  - Consumer continues running
- `priority`: P2

**Scenario 5: Graceful Shutdown**
- `setup`: Start consumer, produce 1 message, wait for processing
- `action`: Send SIGTERM signal
- `assertions`:
  - Consumer disconnects cleanly within 15 seconds
  - No unhandled promise rejections after shutdown
- `priority`: P3

**Validation Rules**:
- Each scenario must be independent (unique groupId per test)
- Each scenario must have a timeout of 30000ms
- Scenarios must execute in order (1 → 5)
- All scenarios must pass for integration test suite to succeed

---

### Test Mocks

Represents mocked OpenCode client dependencies for integration tests.

**Mock: client.sessions.create()**
- `behavior`: Record invocation parameters and resolve immediately
- `records`: Array of `{ agent, prompt }` objects representing calls made
- `purpose`: Verify correct agent and prompt are used without making real LLM calls

**Validation Rules**:
- Mock must reset between tests
- Mock must verify all expected calls were made
- Mock must not make actual network requests to OpenCode

## Relationships

```
CI Workflow
  └─> Validates code changes (no direct relationship to other entities)

Test Container
  └─> Provides brokers for Test Environment Configuration

Test Environment Configuration
  └─> Used by all Test Scenarios

Test Scenario
  ├─> Uses Test Container (via Test Environment Configuration)
  ├─> Uses Test Mocks (for OpenCode client)
  └─> Validates Message Processing Flow (conceptual)

Test Mocks
  └─> Replaces OpenCode client in Test Scenarios
```

## Notes

- No persistent data storage is introduced by this feature
- All entities are transient (exist only during CI/CD execution or test runs)
- Data model focuses on infrastructure and testing rather than domain entities
- Existing source code entities (Rule, PluginConfig, Payload) are not modified