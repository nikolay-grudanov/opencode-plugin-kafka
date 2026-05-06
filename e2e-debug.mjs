/**
 * E2E Debug Script — тестирует Kafka Router Plugin end-to-end
 * 
 * Workflow:
 * 1. Создаёт input топик и DLQ топик
 * 2. Запускает плагин
 * 3. Производит тестовое сообщение в input топик
 * 4. Ждёт обработки и логирует результат
 */

import { Kafka } from 'kafkajs';
import { createOpencodeClient } from '@opencode-ai/sdk';

const BOOTSTRAP_SERVERS = 'localhost:9092';
const INPUT_TOPIC = 'e2e-debug-input';
const DLQ_TOPIC = 'e2e-debug-input-dlq';
const RESPONSE_TOPIC = 'e2e-debug-response';

function log(message) {
  console.log(`[E2E-DEBUG] ${message}`);
}

async function ensureTopics(kafka) {
  const admin = kafka.admin();
  await admin.connect();
  
  const existingTopics = await admin.listTopics();
  const topicsToCreate = [];
  
  if (!existingTopics.includes(INPUT_TOPIC)) {
    topicsToCreate.push({ topic: INPUT_TOPIC, numPartitions: 1, replicationFactor: 1 });
  }
  if (!existingTopics.includes(DLQ_TOPIC)) {
    topicsToCreate.push({ topic: DLQ_TOPIC, numPartitions: 1, replicationFactor: 1 });
  }
  if (!existingTopics.includes(RESPONSE_TOPIC)) {
    topicsToCreate.push({ topic: RESPONSE_TOPIC, numPartitions: 1, replicationFactor: 1 });
  }
  
  if (topicsToCreate.length > 0) {
    await admin.createTopics({ topics: topicsToCreate });
    log(`Created topics: ${topicsToCreate.map(t => t.topic).join(', ')}`);
  }
  
  await admin.disconnect();
}

async function main() {
  log('Starting E2E debug script...');
  log(`Bootstrap servers: ${BOOTSTRAP_SERVERS}`);
  log(`Input topic: ${INPUT_TOPIC}`);
  log(`DLQ topic: ${DLQ_TOPIC}`);
  log(`Response topic: ${RESPONSE_TOPIC}`);
  
  const kafka = new Kafka({
    clientId: 'e2e-debug-consumer',
    brokers: [BOOTSTRAP_SERVERS],
  });
  
  await ensureTopics(kafka);
  
  log('Creating OpenCode SDK client...');
  const sdkClient = createOpencodeClient({
    baseUrl: process.env.OPENCODE_BASE_URL || 'https://api.opencode.ai',
  });
  
  process.env.KAFKA_BROKERS = BOOTSTRAP_SERVERS;
  process.env.KAFKA_CLIENT_ID = 'e2e-debug-consumer';
  process.env.KAFKA_GROUP_ID = 'e2e-debug-consumer-group';
  
  log('Calling plugin...');
  const opencodePlugin = await import('./dist/src/index.js');
  const plugin = opencodePlugin.default;
  
  await plugin({ client: sdkClient, hooks: {} });
  
  log('Waiting 3s for consumer to initialize...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  log('Producing test message to input topic...');
  const producer = kafka.producer();
  await producer.connect();
  
  const testMessage = { task: 'Посчитай 2 + 2 и верни результат' };
  
  await producer.send({
    topic: INPUT_TOPIC,
    messages: [{ key: 'test-1', value: JSON.stringify(testMessage) }],
  });
  
  log(`Sent message: ${JSON.stringify(testMessage)}`);
  await producer.disconnect();
  
  log('Waiting for processing (max 90 seconds)...');
  
  const consumer = kafka.consumer({ groupId: 'e2e-debug-result-consumer' });
  await consumer.connect();
  await consumer.subscribe({ topic: RESPONSE_TOPIC, fromBeginning: true });
  
  let result = null;
  await consumer.run({
    eachMessage: async ({ message }) => {
      log(`Received response: ${message.value?.toString()}`);
      result = message.value?.toString();
    },
  });
  
  const maxWait = 90000;
  const startWait = Date.now();
  while (!result && Date.now() - startWait < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    log('Waiting for response...');
  }
  
  if (result) {
    log(`FINAL RESULT: ${result}`);
  } else {
    log('TIMEOUT: No response received within 90 seconds');
  }
  
  await consumer.disconnect();
  log('E2E debug script completed');
  
  return result;
}

main().catch(error => {
  log(`ERROR: ${error.message}`);
  console.error(error);
  process.exit(1);
});