# Podman Setup for testcontainers-node

**Purpose**: Configure Podman socket for testcontainers-node integration tests
**Date**: 2026-04-22
**Feature**: 001-kafka-router

## Quick Setup

### 1. Start Podman Socket

```bash
systemctl --user start podman.socket
systemctl --user enable podman.socket
```

### 2. Configure Docker Host Environment Variable

```bash
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
```

For permanent configuration, add to `~/.bashrc` or `~/.zshrc`:

```bash
echo 'export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock' >> ~/.bashrc
source ~/.bashrc
```

### 3. Verify Connection

```bash
docker ps
# or
podman ps
```

## CI/CD Environment Setup

### GitHub Actions

```yaml
- name: Setup Podman socket
  run: |
    systemctl --user start podman.socket
    systemctl --user enable podman.socket
    export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
    echo "DOCKER_HOST=$DOCKER_HOST" >> $GITHUB_ENV

- name: Run integration tests
  run: npm test
```

### GitLab CI

```yaml
before_script:
  - systemctl --user start podman.socket || true
  - systemctl --user enable podman.socket || true
  - export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock

test:
  script:
    - npm install
    - npm test
```

### Local Development

```bash
# Start podman socket manually if not running
systemctl --user start podman.socket

# Run tests with explicit docker host
DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock npx vitest tests/integration/
```

## Troubleshooting

### Socket Not Found

If `DOCKER_HOST` socket doesn't exist:

```bash
# Check if podman socket is running
systemctl --user status podman.socket

# Start it if not running
systemctl --user start podman.socket

# Check socket file exists
ls -la $XDG_RUNTIME_DIR/podman/
```

### Permission Denied

If you get permission errors:

```bash
# Check your user is in the podman group (should be by default for rootless)
id

# Try with podman directly to verify
podman ps
```

### Container Cleanup

testcontainers uses Ryuk for cleanup, but if containers persist:

```bash
# Stop all running containers
podman container stop $(podman container ls -q)

# Remove all containers
podman container rm -af

# Remove orphaned volumes
podman volume rm $(podman volume ls -q)
```

## Alternative: DOCKER_HOST via config file

Create `~/.testcontainers.properties`:

```properties
docker.host=unix:///run/user/1000/podman/podman.sock
```

This allows testcontainers to find the socket without environment variable.
