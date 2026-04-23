# Research: CI/CD Pipeline and Integration Tests

**Feature**: CI/CD Pipeline and Integration Tests  
**Date**: 2026-04-23  
**Phase**: 0 - Outline & Research

## Overview

This document consolidates research findings for implementing automated CI/CD validation and integration tests with Redpanda for the opencode-plugin-kafka project. All unknowns from the Technical Context have been resolved.

## Research Findings

### 1. GitHub Actions CI/CD Pipeline Configuration

**Question**: What is the best practice for GitHub Actions workflow for TypeScript projects with sequential validation steps?

**Decision**: Use a single workflow file `.github/workflows/ci.yml` with sequential steps: checkout → setup Node.js → npm ci → lint → typecheck → test → build.

**Rationale**:
- Sequential execution ensures each step completes before the next begins, providing clear failure points
- Using `actions/setup-node@v4` with `cache: 'npm'` significantly reduces installation time by caching `node_modules`
- The workflow triggers on both `push` to `main` and `pull_request` targeting `main` for comprehensive validation
- Concurrency group with `cancel-in-progress: true` prevents resource waste by cancelling outdated runs
- Ubuntu-latest runner provides a stable, well-supported environment for Node.js projects

**Alternatives Considered**:
- **Matrix strategy**: Rejected because this is a single-environment project (no need to test multiple Node versions or OSes)
- **Separate workflows for lint/test/build**: Rejected because it would make the pipeline harder to understand and maintain
- **Docker-based pipeline**: Rejected because Spec 005 will handle Docker builds separately

**Implementation Details**:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
```

### 2. Testcontainers-node with Redpanda

**Question**: How to use testcontainers-node with Redpanda for Kafka integration tests?

**Decision**: Use `@testcontainers/kafka` package (RedpandaContainer) to spin up Redpanda, start once per test suite in `beforeAll`, and stop in `afterAll`.

**Rationale**:
- Redpanda is 10-100x faster than Apache Kafka for container startup (1-2 seconds vs 30-60 seconds)
- `@testcontainers/kafka` provides a well-maintained RedpandaContainer implementation
- Starting the container once per suite (vs per test) reduces overhead and test runtime
- Generous timeouts (60s for beforeAll/afterAll, 30s for individual tests) account for container startup overhead

**Alternatives Considered**:
- **Apache Kafka with testcontainers**: Rejected because of slow JVM startup time (30-60 seconds per test run)
- **Local Kafka instance**: Rejected because it requires manual setup and is not reproducible across environments
- **Mocking Kafka client**: Rejected because integration tests must validate real broker behavior

**Implementation Details**:
```typescript
import { RedpandaContainer } from '@testcontainers/kafka';

let container: RedpandaContainer;
let brokers: string[];

beforeAll(async () => {
  container = await new RedpandaContainer().start();
  brokers = [container.getBootstrapServers()];
}, 60000);

afterAll(async () => {
  await container.stop();
}, 30000);
```

### 3. Vitest Separate Configuration for Integration Tests

**Question**: How to run integration tests separately from unit tests with Vitest?

**Decision**: Create a separate Vitest config file `vitest.integration.config.ts` that only includes integration test files, and add a separate npm script `test:integration`.

**Rationale**:
- Keeps integration tests opt-in (require explicit `npm run test:integration` command)
- Allows unit tests (`npm run test`) to run fast without container overhead
- Integration tests require container runtime (Docker/Podman) which may not be available in all environments
- Separate configs allow different timeouts and reporting options

**Alternatives Considered**:
- **Single config with test tags**: Rejected because it would require running all tests to filter, defeating the purpose
- **Environment variable to toggle test suites**: Rejected because it's less discoverable than explicit scripts
- **Monorepo setup**: Rejected because this is a single-project repository

**Implementation Details**:
```typescript
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    reporters: ['verbose'],
  },
});
```

```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

### 4. Podman Configuration for Testcontainers

**Question**: How to configure testcontainers-node to work with Podman instead of Docker?

**Decision**: Create `.testcontainers.properties` file in repository root with Podman socket configuration and disable Ryuk reaper.

**Rationale**:
- Testcontainers defaults to Docker socket at `/var/run/docker.sock`
- Podman rootless uses a different socket path (typically `/run/user/1000/podman/podman.sock`)
- Ryuk reaper (automatic container cleanup) doesn't work reliably with Podman rootless, so it must be disabled
- Explicit Unix socket strategy is required on Arch/Manjaro where auto-detection may fail
- Configuration is project-level (not a secret) and should be committed to the repository

**Alternatives Considered**:
- **Environment variable DOCKER_HOST**: Rejected as the primary method because it requires manual setup per developer
- **System-wide testcontainers config**: Rejected because it's less portable than project-level config
- **Docker instead of Podman**: Rejected because the developer's environment uses Podman (Manjaro Linux)

**Implementation Details**:
```properties
# .testcontainers.properties
ryuk.disabled=true
docker.host=unix:///run/user/1000/podman/podman.sock
docker.client.strategy=org.testcontainers.dockerclient.UnixSocketClientProviderStrategy
```

**Error Handling for Missing Socket**:
```typescript
beforeAll(async () => {
  try {
    container = await new RedpandaContainer().start();
    brokers = [container.getBootstrapServers()];
  } catch (err) {
    throw new Error(
      'Failed to start Redpanda container.\n' +
      'Make sure Podman socket is running:\n' +
      '  systemctl --user start podman.socket\n' +
      'On Arch/Manjaro, if the service is not persistent across sessions:\n' +
      '  loginctl enable-linger $(whoami)\n' +
      '  systemctl --user enable --now podman.socket\n' +
      'Or override socket path:\n' +
      '  export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock\n' +
      `Original error: ${err}`
    );
  }
}, 60000);
```

### 5. Graceful Shutdown Testing Patterns

**Question**: How to test graceful shutdown of a Kafka consumer in integration tests?

**Decision**: Use `process.emit('SIGTERM')` to simulate shutdown signal and verify that the consumer disconnects cleanly within the timeout.

**Rationale**:
- The consumer's shutdown handler listens for SIGTERM signal
- Emitting the signal programmatically allows testing without external process management
- Timeout of 15 seconds (SC-008) provides a reasonable window for in-flight processing to complete
- Verifying no unhandled promise rejections ensures clean shutdown

**Alternatives Considered**:
- **Calling shutdown function directly**: Considered if the function is exported, but signal emission is more realistic
- **External process with SIGTERM**: Rejected because it adds complexity and is harder to control in tests
- **No shutdown test**: Rejected because graceful shutdown is a critical requirement (FR-010)

**Implementation Details**:
```typescript
test('graceful shutdown', async () => {
  // Start consumer and process one message
  await consumer.start();
  await produceMessage(topic, { data: 'test' });
  await waitForMessageProcessing();
  
  // Emit SIGTERM signal
  process.emit('SIGTERM');
  
  // Wait for shutdown (with timeout)
  await waitForShutdown(15000);
  
  // Verify clean shutdown
  expect(consumer.isConnected()).toBe(false);
  expectUnhandledRejections().toBe(0);
}, 30000);
```

## Summary

All research items have been resolved. The following decisions will guide implementation:

1. **GitHub Actions**: Single workflow with sequential steps, concurrency cancellation, ubuntu-latest runner
2. **Testcontainers**: RedpandaContainer with suite-level lifecycle, generous timeouts
3. **Vitest Config**: Separate config for integration tests, opt-in via npm script
4. **Podman**: Project-level `.testcontainers.properties` with socket path and Ryuk disabled
5. **Graceful Shutdown**: Test via `process.emit('SIGTERM')` with 15-second timeout

No NEEDS CLARIFICATION items remain. Proceeding to Phase 1: Design & Contracts.