/**
 * E2E Exact Flow Script — точно повторяет flow E2E теста T-E2E-001
 * 
 * Workflow:
 * 1. Запустить Redpanda через podman
 * 2. Создать топики через kafkajs
 * 3. Запустить opencode serve
 * 4. Создать SDK client
 * 5. Тестировать session.create (КРИТИЧЕСКИЙ ТЕСТ)
 * 6. Тестировать session.prompt если шаг 5 OK
 * 7. Запустить consumer (опционально)
 * 8. Cleanup
 */

import { spawn } from 'node:child_process';
import { Kafka } from 'kafkajs';

const LOG_PREFIX = {
  STEP: '[E2E-EXACT:STEP]',
  INFO: '[E2E-EXACT:INFO]',
  ERROR: '[E2E-EXACT:ERROR]',
  RESULT: '[E2E-EXACT:RESULT]',
  TEST: '[E2E-EXACT:TEST]',
};

// Константы
const OPENCODE_PORT = 19997;
const KAFKA_BROKERS = ['localhost:9092'];
const INPUT_TOPIC = 'e2e-exact-input';
const RESPONSE_TOPIC = 'e2e-exact-response';
const DLQ_TOPIC = 'e2e-exact-input-dlq';
const REDPANDA_CONTAINER_NAME = 'redpanda-e2e-exact';

const PROJECT_ROOT = '/home/gna/workspase/projects/opencode-plugin-kafka';

// Логирование
function logStep(message) { console.log(`${LOG_PREFIX.STEP} ${message}`); }
function logInfo(message) { console.log(`${LOG_PREFIX.INFO} ${message}`); }
function logError(message) { console.error(`${LOG_PREFIX.ERROR} ${message}`); }
function logResult(message) { console.log(`${LOG_PREFIX.RESULT} ${message}`); }
function logTest(message) { console.log(`${LOG_PREFIX.TEST} ${message}`); }

// Выполнение shell команды через spawn
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

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  let opencodeProcess = null;
  let serverReady = false;

  try {
    // ===== ШАГ 1: Запустить Redpanda через podman =====
    logStep('1. Запуск Redpanda через podman');
    await runCommand(`podman rm -f ${REDPANDA_CONTAINER_NAME} 2>/dev/null || true`);
    
    const podmanCmd = `podman run -d --name ${REDPANDA_CONTAINER_NAME} -p 9092:9092 docker.redpanda.com/redpandadata/redpanda:v23.3.10 redpanda start --overprovisioned --smp 1 --memory 512M --node-id 0`;
    
    logInfo(`Executing: ${podmanCmd}`);
    await runCommand(podmanCmd);
    
    logInfo('Waiting 10 seconds for Redpanda to start...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    logInfo('Redpanda started');

    // ===== ШАГ 2: Создать топики через kafkajs =====
    logStep('2. Создание топиков через kafkajs');
    
    const kafka = new Kafka({ brokers: KAFKA_BROKERS });
    const admin = kafka.admin();
    await admin.connect();
    
    await admin.createTopics({
      topics: [
        { topic: INPUT_TOPIC },
        { topic: RESPONSE_TOPIC },
        { topic: DLQ_TOPIC },
      ],
    });
    logInfo(`Created topics: ${INPUT_TOPIC}, ${RESPONSE_TOPIC}, ${DLQ_TOPIC}`);
    
    await admin.disconnect();
    logInfo('Kafka admin disconnected');

    // ===== ШАГ 3: Запустить opencode serve =====
    logStep('3. Запуск opencode serve');
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
      
      // Ищем "listening" признак
      if (text.includes('listening') || text.includes('Server running') || text.includes(`:${OPENCODE_PORT}`)) {
        if (!serverReady) {
          serverReady = true;
          logInfo('Detected server listening signal');
        }
      }
    });
    
    opencodeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      serverError += text;
      process.stderr.write(text);
    });

    // Ждём "listening" с таймаутом 30 сек
    logInfo('Waiting for "listening" signal (timeout 30s)...');
    const startWait = Date.now();
    const WAIT_TIMEOUT = 30000;
    
    while (!serverReady && Date.now() - startWait < WAIT_TIMEOUT) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (!serverReady) {
      logError('Server did not signal listening within 30s');
      logError(`Server output: ${serverOutput}`);
      logError(`Server error: ${serverError}`);
      throw new Error('opencode serve failed to start');
    }
    
    logInfo('Server is listening!');

    // ===== ШАГ 4: Создать SDK client =====
    logStep('4. Создание SDK client');
    
    // Используем dynamic import как указано в ТЗ
    const { createOpencodeClient } = await import('@opencode-ai/sdk');
    const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${OPENCODE_PORT}` });
    
    logInfo(`SDK client создан с baseUrl: http://127.0.0.1:${OPENCODE_PORT}`);
    logInfo(`Client has session.create: ${typeof client.session?.create}`);
    logInfo(`Client has session.prompt: ${typeof client.session?.prompt}`);

    // ===== ШАГ 5: Тестировать session.create (КРИТИЧЕСКИЙ ТЕСТ) =====
    logStep('5. Тестирование session.create (КРИТИЧЕСКИЙ ТЕСТ)');
    logTest('Calling session.create()...');
    
    try {
      const session = await client.session.create({ body: { title: 'test-exact-flow' } });
      
      logTest(`session.create result type: ${typeof session}`);
      logTest(`session.create keys: ${Object.keys(session).join(', ')}`);
      logTest(`session.data: ${JSON.stringify(session.data)}`);
      logTest(`session.error: ${JSON.stringify(session.error)}`);
      logTest(`session: ${JSON.stringify(session, null, 2)}`);
      
      // Полный вывод для анализа
      console.log('\n========================================');
      console.log('ПОЛНЫЙ РЕЗУЛЬТАТ session.create():');
      console.log('========================================');
      console.log(JSON.stringify(session, null, 2));
      console.log('========================================\n');
      
      // Анализ: есть ли data.id?
      if (session.data?.id) {
        logResult(`✓ session.create ВЕРНУЛ data.id: ${session.data.id}`);
        
        // ===== ШАГ 6: Тестировать session.prompt =====
        logStep('6. Тестирование session.prompt');
        logTest('Calling session.prompt()...');
        
        try {
          const response = await client.session.prompt({
            path: { id: session.data.id },
            body: {
              parts: [{ type: 'text', text: 'Say hello' }],
              agent: 'e2e-responder',
            },
          });
          
          logTest(`session.prompt result type: ${typeof response}`);
          logTest(`session.prompt keys: ${Object.keys(response).join(', ')}`);
          logTest(`response.data: ${JSON.stringify(response.data)?.substring(0, 500)}`);
          
          console.log('\n========================================');
          console.log('ПОЛНЫЙ РЕЗУЛЬТАТ session.prompt():');
          console.log('========================================');
          console.log(JSON.stringify(response, null, 2));
          console.log('========================================\n');
          
          logResult('✓ session.prompt выполнен успешно');
          
        } catch (promptError) {
          logError(`session.prompt error: ${promptError.message}`);
          console.error(promptError);
        }
        
      } else {
        logError('✗ session.create НЕ вернул data.id!');
        logError(`session.data = ${JSON.stringify(session.data)}`);
        logError(`session.error = ${JSON.stringify(session.error)}`);
      }
      
    } catch (sessionError) {
      logError(`session.create ERROR: ${sessionError.message}`);
      console.error(sessionError);
    }

    // ===== ШАГ 7: Consumer (пропускаем) =====
    logStep('7. Consumer step skipped (optional)');

    // ===== ШАГ 8: Cleanup =====
    logStep('8. Cleanup');
    
  } catch (error) {
    logError(`MAIN ERROR: ${error.message}`);
    console.error(error);
    
  } finally {
    // Убиваем opencode serve
    if (opencodeProcess) {
      logInfo('Killing opencode serve process...');
      opencodeProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (!opencodeProcess.killed) {
        opencodeProcess.kill('SIGKILL');
      }
    }
    
    // Удаляем Redpanda контейнер
    try {
      await runCommand(`podman rm -f ${REDPANDA_CONTAINER_NAME}`);
      logInfo('Redpanda container removed');
    } catch (e) {
      logError(`Failed to remove Redpanda: ${e.message}`);
    }
    
    logInfo('Cleanup completed');
  }
}

// Запуск
main().catch((error) => {
  logError(`FATAL: ${error.message}`);
  console.error(error);
  process.exit(1);
});