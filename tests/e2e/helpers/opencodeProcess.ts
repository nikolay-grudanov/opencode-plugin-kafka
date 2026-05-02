/**
 * Вспомогательные функции для управления процессом OpenCode в режиме serve.
 * Используется для E2E тестирования плагина Kafka.
 */

import { spawn } from 'child_process';
import { createServer } from 'net';

/**
 * Интерфейс handle для управления запущенным процессом OpenCode.
 */
interface OpenCodeProcessHandle {
  /** Базовый URL сервера */
  baseURL: string;
  /** PID дочернего процесса */
  pid: number;
  /** Функция для остановки процесса */
  kill(): Promise<void>;
}

/**
 * Поиск свободного порта на localhost.
 * Создаёт временный сервер на случайном порту и возвращает этот порт после закрытия сервера.
 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr !== 'object' || !('port' in addr)) {
        server.close(() => reject(new Error('Unable to determine port')));
        return;
      }
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

/**
 * Ожидание готовности сервера путём опроса эндпоинта /health.
 * @param port - порт для проверки
 * @param timeoutMs - таймаут в миллисекундах
 */
async function waitForServerReady(port: number, timeoutMs: number = 30000): Promise<void> {
  const startTime = Date.now();
  const baseURL = `http://127.0.0.1:${port}`;

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new Error(`Server did not become ready within ${timeoutMs}ms`);
    }

    try {
      const response = await fetch(`${baseURL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });

      if (response.status === 200) {
        return;
      }
    } catch {
      // Игнорируем ошибки сети и продолжаем опрос
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Запуск процесса OpenCode в режиме serve.
 * @returns handle для управления процессом
 */
async function spawnOpenCodeServe(): Promise<OpenCodeProcessHandle> {
  const port = await getFreePort();
  const baseURL = `http://127.0.0.1:${port}`;

  // Создаём дочерний процесс
  const childProcess = spawn('opencode', ['serve', '--port', String(port)], {
    detached: false,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Настраиваем логирование stdout
  const handleStdout = (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log(`[opencode-serve] ${line}`);
    }
  };

  // Настраиваем логирование stderr
  const handleStderr = (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.warn(`[opencode-serve] ${line}`);
    }
  };

  if (childProcess.stdout) {
    childProcess.stdout.on('data', handleStdout);
  }

  if (childProcess.stderr) {
    childProcess.stderr.on('data', handleStderr);
  }

  // Ожидаем готовности сервера
  try {
    await waitForServerReady(port, 30000);
  } catch (error) {
    // При ошибке убиваем процесс и прокидываем ошибку
    childProcess.kill('SIGTERM');
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenCode serve failed to start on port ${port}: ${errorMessage}`);
  }

  const pid = childProcess.pid;
  if (!pid) {
    childProcess.kill('SIGTERM');
    throw new Error('Failed to get PID of spawned process');
  }

  // Возвращаем handle
  return {
    baseURL,
    pid,
    kill: async () => {
      try {
        // Отправляем SIGTERM и ожидаем завершения
        const killed = childProcess.kill('SIGTERM');

        if (!killed) {
          // Процесс уже мёртв
          return;
        }

        // Ожидаем 5 секунд и убиваем через SIGKILL если всё ещё жив
        await new Promise((resolve) => setTimeout(resolve, 5000));

        try {
          childProcess.kill('SIGKILL');
        } catch {
          // Игнорируем ошибки — процесс возможно уже завершён
        }
      } catch (error) {
        // Подавляем все ошибки при завершении
        const errorObj = error instanceof Error ? error : new Error(String(error));
        console.log(JSON.stringify({
          msg: 'Error during kill',
          error: errorObj.message,
          pid,
        }));
      }
    },
  };
}

export { spawnOpenCodeServe };
export type { OpenCodeProcessHandle };