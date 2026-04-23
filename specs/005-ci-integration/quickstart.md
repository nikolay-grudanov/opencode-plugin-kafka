# Developer Quickstart: CI/CD and Integration Tests

**Feature**: CI/CD Pipeline and Integration Tests  
**Date**: 2026-04-23  
**Phase**: 1 - Design & Contracts

## Overview

This guide helps developers get started with the new CI/CD pipeline and integration tests infrastructure for the opencode-plugin-kafka project.

## Prerequisites

- Node.js 20 or higher
- npm or yarn package manager
- Git
- Container runtime: Docker OR Podman (for integration tests only)
- Access to GitHub repository (for CI/CD)

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd opencode-plugin-kafka
npm install
```

### 2. Run Unit Tests

Unit tests run quickly without any external dependencies:

```bash
npm run test
```

This runs all unit tests in `tests/unit/` directory using Vitest.

### 3. Run CI/CD Pipeline Locally

To simulate the CI/CD pipeline locally, run all validation steps:

```bash
npm run lint        # ESLint validation
npm run typecheck   # TypeScript type checking
npm run test        # Unit tests
npm run build       # Compile TypeScript
```

These are the same steps that execute in GitHub Actions on every push to main and every pull request.

## Running Integration Tests

Integration tests require a container runtime (Docker or Podman) to spin up a real Redpanda message broker. Choose the setup that matches your environment.

### With Podman on Manjaro/Arch Linux (rootless)

**Step 1: Enable linger** (so the user service persists without an active session):

```bash
loginctl enable-linger $(whoami)
```

**Step 2: Enable and start the Podman socket**:

```bash
systemctl --user enable --now podman.socket
```

**Step 3: Verify the socket exists**:

```bash
ls /run/user/$(id -u)/podman/podman.sock
```

**Step 4: Copy and configure testcontainers properties**:

```bash
cp .testcontainers.properties.example .testcontainers.properties && sed -i "s/<YOUR_UID>/$(id -u)/" .testcontainers.properties
```

**Step 5: Run integration tests**:

```bash
npm run test:integration
```

The `.testcontainers.properties` file in the repo root configures testcontainers to use Podman automatically. No `DOCKER_HOST` export needed if your UID is 1000.

**If your UID differs from 1000**:

```bash
export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
npm run test:integration
```

### With Podman on Ubuntu/Fedora (rootless)

Same steps as above. Skip `loginctl` if you are running in an active desktop session.

### With Docker (Linux/macOS)

No additional configuration needed. The `.testcontainers.properties` file can be ignored or removed, or you can override via:

```bash
export DOCKER_HOST=unix:///var/run/docker.sock
npm run test:integration
```

### Troubleshooting Integration Tests

**Error: "Failed to start Redpanda container"**

This usually means the container socket is not accessible. Ensure:

1. Podman/Docker daemon is running:
   ```bash
   # Podman
   systemctl --user status podman.socket
   
   # Docker
   sudo systemctl status docker
   ```

2. Socket path is correct:
   ```bash
   # Verify Podman socket
   ls /run/user/$(id -u)/podman/podman.sock
   
   # Verify Docker socket
   ls /var/run/docker.sock
   ```

3. Permissions are correct:
   ```bash
   # For Docker, ensure user is in docker group
   sudo usermod -aG docker $USER
   # Log out and back in for changes to take effect
   ```

**Tests timeout after 60 seconds**

This indicates the container is taking too long to start. Check:

1. Sufficient system resources (CPU, RAM)
2. Network connectivity for pulling the Redpanda image
3. No other processes blocking the container runtime

**Integration tests not found**

Ensure you're running the correct command:

```bash
# Wrong (runs only unit tests)
npm run test

# Correct (runs only integration tests)
npm run test:integration
```

## CI/CD Pipeline

### How It Works

The GitHub Actions workflow (`.github/workflows/ci.yml`) automatically runs on:

- Every push to the `main` branch
- Every pull request targeting the `main` branch

The pipeline executes these steps in order:

1. **Checkout** - Fetch repository code
2. **Setup Node.js** - Install Node.js 20 with npm cache
3. **Install dependencies** - Run `npm ci`
4. **Lint** - Run ESLint (`npm run lint`)
5. **Type check** - Run TypeScript compiler (`npm run typecheck`)
6. **Test** - Run unit tests (`npm run test`)
7. **Build** - Compile TypeScript (`npm run build`)

If any step fails, the pipeline stops and reports the failure.

### Viewing Pipeline Results

1. Go to the GitHub repository
2. Click on the "Actions" tab
3. Select a workflow run from the list
4. Expand each step to view logs and results

### Concurrency

The pipeline includes concurrency cancellation: if you push multiple changes to the same pull request, only the latest run will execute. Previous in-progress runs are automatically cancelled.

### Integration Tests in CI

**Note**: Integration tests are NOT run in CI during this phase. They require a container runtime (Docker/Podman) which is not available on GitHub's standard runners. Integration tests will be added to CI in a future phase when a self-hosted runner with Podman is configured.

To run integration tests, use `npm run test:integration` locally as described above.

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Changes

Edit code, add tests, update documentation as needed.

### 3. Run Validation Locally

Before pushing, run the full validation suite:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

This ensures your changes will pass the CI/CD pipeline.

### 4. Run Integration Tests (If Applicable)

If your changes affect the consumer or message processing:

```bash
npm run test:integration
```

### 5. Commit and Push

```bash
git add .
git commit -m "feat: description of your changes"
git push origin feature/your-feature-name
```

### 6. Create Pull Request

1. Go to GitHub and create a pull request targeting `main`
2. The CI/CD pipeline will automatically run
3. Wait for all checks to pass (green checkmarks)
4. Request code review

### 7. Merge

After approval and all checks pass, merge your pull request. The CI/CD pipeline will run again on the merge commit to verify the final state.

## Project Structure

```
.github/workflows/
└── ci.yml                           # GitHub Actions CI/CD pipeline

specs/005-ci-integration/
├── spec.md                          # Feature specification
├── plan.md                          # Implementation plan
├── research.md                      # Research findings
├── data-model.md                    # Data entities
├── quickstart.md                    # This file
└── checklists/
    └── requirements.md              # Specification quality checklist

tests/
├── unit/                            # Unit tests (fast, no dependencies)
└── integration/                     # Integration tests (require container)
    └── consumer.integration.test.ts # Consumer integration tests

vitest.config.ts                     # Vitest config for unit tests
vitest.integration.config.ts         # Vitest config for integration tests

.testcontainers.properties           # Testcontainers configuration for Podman

package.json                         # Scripts: test, test:integration, lint, typecheck, build
```

## Next Steps

- Review the [feature specification](./spec.md) for detailed requirements
- Check the [implementation plan](./plan.md) for technical details
- Read the [research findings](./research.md) for design decisions
- Explore the [data model](./data-model.md) for entity definitions

## Getting Help

If you encounter issues:

1. Check the troubleshooting section above
2. Review GitHub Actions logs for CI/CD failures
3. Consult the project README.md for general project information
4. Open an issue on GitHub with detailed error messages and steps to reproduce
