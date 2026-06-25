/**
 * Скрипт для ручного тестирования Kafka→Agent pipeline
 *
 * Workflow:
 * 1. Запустить Redpanda через podman
 * 2. Создать топики
 * 3. Запустить opencode serve
 * 4. Запустить consumer (вызвать startConsumer напрямую)
 * 5. Отправить тестовое сообщение через kafkajs
 * 6. Читать ответ из test-response
 * 7. Очистка при exit
 *
 * Использование:
 *   node scripts/manual-test.mjs
 *
 * Требования:
 *   - Node.js 20+
 *   - podman с доступом к redpanda образу
 *   - Собранный проект в dist/
 */

import { spawn } from 'node:child_process';
import { Kafka } from 'kafkajs';

// Константы
const REDPANDA_CONTAINER_NAME = 'redpanda-manual';
const KAFKA_BROKERS = 'localhost:9092';
const INPUT_TOPIC = 'test-input';
const RESPONSE_TOPIC = 'test-response';
const DLQ_TOPIC = 'test-input-dlq';
const OPENCODE_PORT = 19999;
const PROJECT_ROOT = '/home/gna/workspase/projects/opencode-plugin-kafka';

// Префиксы логирования
const LOG_PREFIX = {
  STEP: '[MANUAL-TEST:STEP]',
  INFO: '[MANUAL-TEST:INFO]',
  ERROR: '[MANUAL-TEST:ERROR]',
  RESULT: '[MANUAL-TEST:RESULT]',
};

// Функции логирования
function logStep(message) { console.log(`${LOG_PREFIX.STEP} ${message}`); }
function logInfo(message) { console.log(`${LOG_PREFIX.INFO} ${message}`); }
function logError(message) { console.error(`${LOG_PREFIX.ERROR} ${message}`); }
function logResult(message) { console.log(`${LOG_PREFIX.RESULT} ${message}`); }

/**
 * Выполнение shell команды через child_process.spawn
 *
 * @param command - Команда для выполнения
 * @param args - Аргументы команды
 * @returns Promise с результатом выполнения
 */
function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { shell: true });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Ожидание port доступности
 *
 * @param host - Хост для проверки
 * @param port - Порт для проверки
 * @param timeoutMs - Таймаут в миллисекундах
 */
async function waitForPort(host, port, timeoutMs = 30000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Простая проверка через TCP connect
      const net = await import('node:net');
      return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('Timeout'));
        });
        socket.on('error', reject);
        socket.connect(port, host);
      });
    } catch {
      // Порт не готов, ждём и повторяем
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Port ${port} not ready after ${timeoutMs}ms`);
}

/**
 * Основная функция
 */
async function main() {
  let opencodeProcess = null;
  let opencodeReady = false;
  let consumerStopped = false;

  // Обработчик graceful shutdown
  async function cleanup() {
    if (consumerStopped) return;
    consumerStopped = true;

    logInfo('Starting cleanup...');

    // Останавливаем opencode serve процесс
    if (opencodeProcess && !opencodeProcess.killed) {
      logInfo('Killing opencode serve process...');
      opencodeProcess.kill('SIGTERM');
      // Даём время на graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (!opencodeProcess.killed) {
        opencodeProcess.kill('SIGKILL');
      }
    }

    logInfo('Cleanup completed');
  }

  // Регистрируем обработчики сигналов
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // ===== ШАГ 1: Запустить Redpanda через podman =====
    logStep('1. Запуск Redpanda через podman');

    await runCommand(`podman rm -f ${REDPANDA_CONTAINER_NAME} 2>/dev/null || true`);

    const podmanCmd = `podman run -d --name ${REDPANDA_CONTAINER_NAME} -p 9092:9092 docker.redpanda.com/redpandadata/redpanda:latest`;
    logInfo(`Executing: ${podmanCmd}`);

    await runCommand(podmanCmd);

    logInfo('Waiting 5 seconds for Redpanda to start...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Проверяем доступность порта
    await waitForPort('localhost', 9092, 30000);
    logInfo('Redpanda is ready on port 9092');

    // ===== ШАГ 2: Создать топики =====
    logStep('2. Создание топиков');

    const createTopicsCmd = `podman exec ${REDPANDA_CONTAINER_NAME} rpk topic create ${INPUT_TOPIC} ${RESPONSE_TOPIC} ${DLQ_TOPIC}`;
    logInfo(`Executing: ${createTopicsCmd}`);

    await runCommand(createTopicsCmd);
    logInfo(`Created topics: ${INPUT_TOPIC}, ${RESPONSE_TOPIC}, ${DLQ_TOPIC}`);

    // ===== ШАГ 3: Запустить opencode serve =====
    logStep('3. Запуск opencode serve');

    logInfo(`Starting opencode serve on port ${OPENCODE_PORT}...`);

    opencodeProcess = spawn('opencode', ['serve', '--port', String(OPENCODE_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let serverOutput = '';
    let serverError = '';

    opencodeProcess.stdout.on('data', (data) => {
      const text = data.toString();
      serverOutput += text;
      process.stdout.write(text);

      // Ищем признак готовности сервера
      if (text.includes('listening') || text.includes('Server running') || text.includes(`:${OPENCODE_PORT}`)) {
        if (!opencodeReady) {
          opencodeReady = true;
          logInfo('Detected server listening signal');
        }
      }
    });

    opencodeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      serverError += text;
      process.stderr.write(text);
    });

    opencodeProcess.on('exit', (code) => {
      logError(`opencode serve exited with code ${code}`);
      if (!consumerStopped) {
        cleanup().then(() => process.exit(1));
      }
    });

    // Ждём readiness с таймаутом 30 сек
    logInfo('Waiting for opencode serve to be ready (timeout 30s)...');
    const startWait = Date.now();
    const WAIT_TIMEOUT = 30000;

    while (!opencodeReady && Date.now() - startWait < WAIT_TIMEOUT) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!opencodeReady) {
      throw new Error('opencode serve failed to start within 30 seconds');
    }

    logInfo('opencode serve is ready!');

    // ===== ШАГ 4: Запустить consumer (startConsumer) =====
    logStep('4. Запуск consumer через startConsumer');

    // Динамические импорты из dist/
    logInfo('Importing from dist/...');

    const consumerModule = await import('../dist/src/kafka/consumer.js');
    const { startConsumer } = consumerModule;

    const adapterModule = await import('../dist/src/opencode/OpenCodeAgentAdapter.js');
    const { OpenCodeAgentAdapter } = adapterModule;

    const sdk = await import('@opencode-ai/sdk');
    const { createOpencodeClient } = sdk;

    // Установка переменных окружения
    process.env.KAFKA_BROKERS = KAFKA_BROKERS;
    process.env.KAFKA_CLIENT_ID = 'manual-test-client';
    process.env.KAFKA_GROUP_ID = `manual-test-group-${Date.now()}`;

    logInfo(`KAFKA_BROKERS: ${process.env.KAFKA_BROKERS}`);
    logInfo(`KAFKA_CLIENT_ID: ${process.env.KAFKA_CLIENT_ID}`);
    logInfo(`KAFKA_GROUP_ID: ${process.env.KAFKA_GROUP_ID}`);

    // Создание SDK клиента
    const sdkClient = createOpencodeClient({ baseUrl: `http://127.0.0.1:${OPENCODE_PORT}` });
    logInfo('SDK client created');

    // Создание адаптера
    const agent = new OpenCodeAgentAdapter(sdkClient);
    logInfo('OpenCodeAgentAdapter created');

    // Конфигурация consumer
    const config = {
      topics: [INPUT_TOPIC],
      rules: [
        {
          name: 'manual-test-rule',
          jsonPath: '$.task',
          promptTemplate: '${$.task}',
          agentId: 'e2e-responder',
          responseTopic: RESPONSE_TOPIC,
          timeoutMs: 120000,
        },
      ],
    };

    logInfo(`Consumer config: ${JSON.stringify(config, null, 2)}`);

    // Запуск consumer
    logInfo('Starting consumer...');
    await startConsumer(config, agent);
    logInfo('Consumer started! Waiting 5s for consumer to join group...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    logInfo('Consumer should be ready now');

    // ===== ШАГ 6: Подписаться на response топик (ДО отправки сообщения) =====
    logStep('6. Подписка на response топик');

    const kafka = new Kafka({
      clientId: 'manual-producer',
      brokers: [KAFKA_BROKERS],
    });

    const responseConsumer = kafka.consumer({
      groupId: `manual-reader-${Date.now()}`,
    });

    await responseConsumer.connect();
    logInfo('Response consumer connected');

    await responseConsumer.subscribe({
      topic: RESPONSE_TOPIC,
      fromBeginning: true,
    });

    logInfo(`Subscribed to topic: ${RESPONSE_TOPIC}`);

    // Таймаут ожидания ответа (60 секунд)
    const responseTimeoutMs = 60000;
    let responseReceived = false;

    await responseConsumer.run({
      eachMessage: async ({ message }) => {
        if (responseReceived) return;
        responseReceived = true;

        logResult('=== ОТВЕТ ПОЛУЧЕН ===');
        const value = message.value.toString();
        logResult(`Raw value: ${value}`);

        try {
          const parsed = JSON.parse(value);
          logResult(`Parsed: ${JSON.stringify(parsed, null, 2)}`);
        } catch (parseError) {
          logResult(`Failed to parse: ${parseError.message}`);
          logResult(`Value: ${value}`);
        }
        logResult('========================');

        // Выход после получения первого ответа
        setTimeout(async () => {
          logInfo('Disconnecting consumer and cleaning up...');
          await responseConsumer.disconnect();
          await cleanup();
          process.exit(0);
        }, 1000);
      },
    });

    logInfo('Response consumer is running, waiting for messages...');

    // Таймаут если ответ не получен
    setTimeout(() => {
      if (!responseReceived) {
        logError(`Timeout: no response received within ${responseTimeoutMs}ms`);
        responseConsumer.disconnect();
        cleanup().then(() => process.exit(1));
      }
    }, responseTimeoutMs);

    // ===== ШАГ 5: Отправить тестовое сообщение (ПОСЛЕ подписки) =====
    logStep('5. Отправка тестового сообщения в топик');

    const producer = kafka.producer();
    await producer.connect();
    logInfo('Producer connected');

    const testMessage = {
      task: 'Что такое 2+2? Ответь коротко.',
      correlationId: 'test-001',
    };

    await producer.send({
      topic: INPUT_TOPIC,
      messages: [
        {
          key: 'test-001',
          value: JSON.stringify(testMessage),
        },
      ],
    });

    logInfo(`Sent message: ${JSON.stringify(testMessage)}`);
    await producer.disconnect();
    logInfo('Producer disconnected');

  } catch (error) {
    logError(`Error: ${error.message}`);
    logError(error.stack);
    await cleanup();
    process.exit(1);
  }
}

// Запуск
main().catch((error) => {
  logError(`Fatal error: ${error.message}`);
  logError(error.stack);
  process.exit(1);
});