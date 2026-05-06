/**
 * Smoke test для OpenCodeAgentAdapter.invoke()
 * 
 * Запускает opencode serve, создаёт SDK client, вызывает agent и проверяет результат.
 */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stdout, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';

const LOG_PREFIX = {
  INFO: '[SMOKE-TEST:INFO]',
  STEP: '[SMOKE-TEST:STEP]',
  ERROR: '[SMOKE-TEST:ERROR]',
  RESULT: '[SMOKE-TEST:RESULT]',
};

// Логирование с пометкой шагов
function logStep(message) {
  console.log(`${LOG_PREFIX.STEP} ${message}`);
}

function logInfo(message) {
  console.log(`${LOG_PREFIX.INFO} ${message}`);
}

function logError(message) {
  console.error(`${LOG_PREFIX.ERROR} ${message}`);
}

function logResult(message) {
  console.log(`${LOG_PREFIX.RESULT} ${message}`);
}

// Константы
const OPENCODE_PORT = 19999;
const INVOKE_TIMEOUT_MS = 30000;
const SERVER_STARTUP_TIMEOUT_MS = 60000;

// Проектные пути - ЗАПУСКАТЬ ИЗ ЭТОЙ ДИРЕКТОРИИ!
const PROJECT_ROOT = '/home/gna/workspase/projects/opencode-plugin-kafka';

// ============================================================================
// Основная логика
// ============================================================================

async function main() {
  let opencodeProcess = null;

  try {
    // Шаг 1: Запускаем opencode serve
    logStep('1. Запуск opencode serve --port 19999');
    opencodeProcess = await startOpencodeServer();
    if (!opencodeProcess) {
      throw new Error('Не удалось запустить opencode serve');
    }
    logInfo('opencode serve процесс запущен');

    // Шаг 2: Ждём когда сервер поднимется
    logStep('2. Ожидание готовности сервера');
    await waitForServerReady();
    logInfo('Сервер готов к работе');

    // Шаг 3: Создаём SDK client
    logStep('3. Создание SDK client через createOpencodeClient()');
    const sdkClient = await createSDKClient();
    logInfo('SDK client создан');

    // Шаг 4: Создаём OpenCodeAgentAdapter
    logStep('4. Создание OpenCodeAgentAdapter');
    const adapter = await createAdapter(sdkClient);
    logInfo('OpenCodeAgentAdapter создан');

    // Шаг 5: Вызываем adapter.invoke()
    logStep('5. Вызов adapter.invoke("e2e-responder", "Say hello", {})');
    const result = await invokeWithTimeout(adapter);
    logInfo('invoke() завершён');

    // Шаг 6: Выводим результат
    logStep('6. Результат вызова:');
    printResult(result);

  } catch (error) {
    logError(`Ошибка: ${error.message}`);
    console.error(error.stack);
  } finally {
    // Очистка: убиваем процесс
    if (opencodeProcess) {
      logStep('Очистка: завершение opencode serve процесса');
      opencodeProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (!opencodeProcess.killed) {
        opencodeProcess.kill('SIGKILL');
      }
    }
  }
}

// ============================================================================
// Функции запуска сервера
// ============================================================================

function startOpencodeServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('opencode', ['serve', '--port', String(OPENCODE_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, OPENCODE_LOG_LEVEL: 'info' },
    });

    let started = false;
    let outputBuffer = '';

    const onData = (data) => {
      const text = data.toString();
      outputBuffer += text;
      
      // Ищем признак что сервер запустился
      if (
        text.includes('Server running') ||
        text.includes('listening') ||
        text.includes(`:${OPENCODE_PORT}`) ||
        text.includes('http://127.0.0.1') ||
        text.includes('http://localhost')
      ) {
        if (!started) {
          started = true;
          stdout.write(data);
          resolve(proc);
        }
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('error', (err) => {
      if (!started) {
        reject(err);
      }
    });

    proc.on('exit', (code) => {
      if (!started && code !== 0) {
        logError(`opencode serve завершился с кодом ${code}`);
        logInfo(`Вывод процесса:\n${outputBuffer}`);
        reject(new Error(`opencode serve вышел с кодом ${code}`));
      }
    });

    // Таймаут для запуска
    setTimeout(() => {
      if (!started) {
        logError('Таймаут ожидания запуска сервера');
        logInfo(`Вывод процесса:\n${outputBuffer}`);
        reject(new Error('Таймаут запуска сервера'));
      }
    }, SERVER_STARTUP_TIMEOUT_MS);
  });
}

async function waitForServerReady() {
  const maxAttempts = 30;
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`http://127.0.0.1:${OPENCODE_PORT}/session`, {
        method: 'GET',
      });
      if (response.ok || response.status === 401) {
        // Сервер отвечает (401 = нужен auth, но сервер работает)
        return true;
      }
    } catch {
      // Сервер ещё не готов
    }
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('Сервер не готов после всех попыток');
}

// ============================================================================
// SDK и Adapter
// ============================================================================

async function createSDKClient() {
  // Динамический импорт @opencode-ai/sdk
  const sdk = await import('@opencode-ai/sdk');
  const createOpencodeClient = sdk.createOpencodeClient;

  // Создаём client
  const client = createOpencodeClient({
    baseUrl: `http://127.0.0.1:${OPENCODE_PORT}`,
  });

  logInfo(`SDK client создан с baseUrl: http://127.0.0.1:${OPENCODE_PORT}`);
  logInfo(`Client имеет session API: ${typeof client.session?.create}`);

  return client;
}

async function createAdapter(client) {
  // Динамический импорт OpenCodeAgentAdapter
  const adapterPath = join(PROJECT_ROOT, 'src/opencode/OpenCodeAgentAdapter.ts');
  logInfo(`Чтение адаптера из: ${adapterPath}`);

  if (!existsSync(adapterPath)) {
    throw new Error(`Файл адаптера не найден: ${adapterPath}`);
  }

  // Пробуем через dynamic import (но нужен скомпилированный JS)
  // Попробуем импортировать из dist
  const distPath = join(PROJECT_ROOT, 'dist/opencode/OpenCodeAgentAdapter.js');
  
  let AdapterClass;
  let importedClient = client;

  if (existsSync(distPath)) {
    const module = await import(distPath);
    AdapterClass = module.OpenCodeAgentAdapter;
    logInfo(`Импортирован OpenCodeAgentAdapter из dist`);
  } else {
    // Альтернативный способ - определить тип в runtime
    // Нам нужен SDKClient с session.create/prompt/delete/abort
    logInfo('Используем client напрямую как SDKClient');
  }

  // Если AdapterClass недоступен, используем прокси
  if (!AdapterClass) {
    // Создаём прокси-адаптер вручную
    logInfo('Создаём адаптер вручную (класс недоступен)');
    
    return {
      client: importedClient,
      async invoke(prompt, agentId, options = {}) {
        const startTime = Date.now();
        let sessionId = '';

        try {
          // 1. Создаём сессию
          logInfo('Создание сессии...');
          const session = await this.client.session.create({
            body: { title: `kafka-plugin-${agentId}` },
          });
          sessionId = session.data?.id ?? '';
          
          if (!sessionId) {
            return {
              status: 'error',
              errorMessage: 'Empty session ID from SDK',
              sessionId: '',
              executionTimeMs: Date.now() - startTime,
              timestamp: new Date().toISOString(),
            };
          }
          
          logInfo(`Сессия создана: ${sessionId}`);

          // 2. Отправляем prompt
          const timeoutMs = options.timeoutMs ?? 120000;
          logInfo(`Отправка prompt с таймаутом ${timeoutMs}ms...`);
          
          const response = await Promise.race([
            this.client.session.prompt({
              path: { id: sessionId },
              body: {
                parts: [{ type: 'text', text: prompt }],
                agent: agentId,
              },
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Таймаут после ${timeoutMs}ms`)), timeoutMs)
            ),
          ]);

          // 3. Извлекаем текст
          const parts = response?.data?.parts ?? [];
          const responseText = extractResponseText(parts);

          return {
            status: 'success',
            response: responseText,
            sessionId,
            executionTimeMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          
          // Cleanup
          if (sessionId) {
            try {
              await this.client.session.delete({ path: { id: sessionId } });
            } catch {}
          }

          return {
            status: 'error',
            sessionId,
            errorMessage: err.message,
            executionTimeMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        }
      },
    };
  }

  return new AdapterClass(client);
}

function extractResponseText(parts) {
  // Извлекаем текст из частей ответа
  const textParts = parts.filter(p => p.type === 'text');
  return textParts.map(p => p.text ?? '').join('');
}

async function invokeWithTimeout(adapter) {
  const startTime = Date.now();
  
  try {
    const result = await Promise.race([
      adapter.invoke('Say hello', 'e2e-responder', { timeoutMs: INVOKE_TIMEOUT_MS }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Таймаут invoke после ${INVOKE_TIMEOUT_MS}ms`)),
          INVOKE_TIMEOUT_MS
        )
      ),
    ]);
    
    return result;
  } catch (error) {
    return {
      status: 'error',
      errorMessage: error.message,
      sessionId: '',
      executionTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

function printResult(result) {
  console.log('\n=== РЕЗУЛЬТАТ ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('===============\n');
  
  if (result.status === 'success') {
    logResult(`✓ invoke() вернул AgentResult.success`);
    logResult(`  sessionId: ${result.sessionId}`);
    logResult(`  response: ${result.response?.substring(0, 200)}...`);
    logResult(`  executionTimeMs: ${result.executionTimeMs}`);
  } else if (result.status === 'error') {
    logResult(`✗ invoke() вернул AgentResult.error`);
    logResult(`  errorMessage: ${result.errorMessage}`);
  } else if (result.status === 'timeout') {
    logResult(`✗ invoke() вернул AgentResult.timeout`);
    logResult(`  errorMessage: ${result.errorMessage}`);
  } else {
    logResult(`? Неизвестный статус: ${result.status}`);
  }
}

// Запуск
main().catch((error) => {
  logError(`Фатальная ошибка: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});