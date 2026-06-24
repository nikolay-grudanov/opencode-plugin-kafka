/**
 * Spawn opencode serve as a child process for e2e tests.
 *
 * Wrapper around opencode CLI that:
 * - Picks a free port (auto-assigned by opencode --port 0)
 * - Polls /health until ready or timeout
 * - Tracks the process handle for cleanup in afterAll
 *
 * Used by tests/e2e/consumer.e2e.test.ts to start the server before
 * tests can produce messages to Kafka.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export interface OpenCodeProcessHandle {
  /** PID of the opencode child process. */
  pid: number;
  /** The base URL of the running server (http://127.0.0.1:<port>). */
  baseUrl: string;
  /** Original opencode --port argument (may be 0 = auto-assigned). */
  port: number;
  /** Kill the process tree. Safe to call multiple times. */
  kill(): Promise<void>;
}

/**
 * Spawn opencode serve with the local plugin loaded.
 *
 * The plugin is picked up via .opencode/opencode.json's `plugin` field,
 * which references .opencode/plugins/kafka-router.js. So we just spawn
 * opencode serve in the project root.
 *
 * The plugin reads KAFKA_BROKERS / KAFKA_CLIENT_ID / KAFKA_GROUP_ID
 * from the spawned process env.
 */
export async function spawnOpenCodeServe(
  env: Record<string, string>,
  options: {
    /** Startup timeout in ms (default 30000). */
    startupTimeoutMs?: number;
    /** Health-poll interval in ms (default 500). */
    healthIntervalMs?: number;
    /** Specific port to use (default: 0 = auto-assign by OS). */
    port?: number;
  } = {}
): Promise<OpenCodeProcessHandle> {
  const port = options.port ?? 0;
  const startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
  const healthIntervalMs = options.healthIntervalMs ?? 500;

  // Buffer to capture the actual port from opencode's startup log
  // (opencode prints "opencode server listening on http://127.0.0.1:<port>"
  // to stderr when --port 0 is used).
  let capturedPort: number | null = null;
  const portCaptureRegex = /listening on (?:https?:\/\/)?127\.0\.0\.1:(\d+)/;

  const child: ChildProcess = spawn(
    'opencode',
    ['serve', '--port', String(port), '--hostname', '127.0.0.1', '--print-logs', '--log-level', 'INFO'],
    {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    const match = text.match(portCaptureRegex);
    if (match && capturedPort === null) {
      capturedPort = Number(match[1]);
    }
  });
  child.stdout?.on('data', () => {
    // suppress stdout
  });

  // Wait for port capture or timeout
  const deadline = Date.now() + startupTimeoutMs;
  while (capturedPort === null && Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`opencode serve exited early with code ${child.exitCode}`);
    }
    await sleep(100);
  }

  if (capturedPort === null) {
    child.kill('SIGTERM');
    throw new Error(`opencode serve did not bind to a port within ${startupTimeoutMs}ms`);
  }

  const baseUrl = `http://127.0.0.1:${capturedPort}`;

  // Wait for /health to return 200
  const healthDeadline = Date.now() + startupTimeoutMs;
  let healthy = false;
  while (Date.now() < healthDeadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      // not ready yet
    }
    await sleep(healthIntervalMs);
  }

  if (!healthy) {
    child.kill('SIGTERM');
    throw new Error(`opencode serve health check failed within ${startupTimeoutMs}ms`);
  }

  let killed = false;
  return {
    pid: child.pid ?? -1,
    baseUrl,
    port: capturedPort,
    async kill() {
      if (killed) return;
      killed = true;
      child.kill('SIGTERM');
      await sleep(1000);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    },
  };
}

/**
 * Pre-flight check: opencode CLI must be installed and on PATH.
 * Returns true if `opencode --version` exits 0, false otherwise.
 */
export async function isOpenCodeAvailable(): Promise<boolean> {
  try {
    const child = spawn('opencode', ['--version'], { stdio: 'ignore' });
    return await new Promise<boolean>((resolve) => {
      child.on('exit', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve(false);
      }, 5000);
    });
  } catch {
    return false;
  }
}