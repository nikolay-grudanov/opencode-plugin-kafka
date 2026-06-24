/**
 * E2E Test Script for Kafka Demo Environment
 * 
 * This script verifies the Kafka demo environment is working by:
 * 1. Producing test messages to demo topics
 * 2. Consuming and verifying messages
 * 3. Testing healthcheck topics
 * 
 * Usage: node scripts/kafka-e2e-demo.mjs
 */

import { Kafka, Partitioners } from 'kafkajs';

const BROKERS = process.env.KAFKA_BROKERS?.split(',') || ['localhost:9093'];
const CLIENT_ID = 'kafka-e2e-demo';
const GROUP_ID = 'kafka-e2e-demo-group';

const DEMO_TOPICS = {
  prompts: 'opencode.prompts',
  responses: 'opencode.responses',
  dlq: 'opencode.dlq',
  healthcheck: 'demo.healthcheck',
  agentRequests: 'demo.agent-requests',
  agentResponses: 'demo.agent-responses',
};

const kafka = new Kafka({
  clientId: CLIENT_ID,
  brokers: BROKERS,
});

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

async function testHealthcheckProducer() {
  const producer = kafka.producer();
  await producer.connect();
  
  await producer.send({
    topic: DEMO_TOPICS.healthcheck,
    messages: [{
      key: 'healthcheck-001',
      value: JSON.stringify({
        timestamp: new Date().toISOString(),
        status: 'healthy',
        service: 'kafka-e2e-demo',
      }),
    }],
  });
  
  await producer.disconnect();
}

async function testHealthcheckConsumer() {
  const consumer = kafka.consumer({ groupId: `${GROUP_ID}-healthcheck` });
  await consumer.connect();
  await consumer.subscribe({ topic: DEMO_TOPICS.healthcheck, fromBeginning: true });
  
  const messages = [];
  await consumer.run({
    eachMessage: async ({ message }) => {
      const value = message.value?.toString();
      if (value) messages.push(JSON.parse(value));
    },
  });
  
  await new Promise(r => setTimeout(r, 2000));
  await consumer.disconnect();
  
  if (messages.length === 0) {
    throw new Error('No healthcheck messages received');
  }
}

async function testAgentRequests() {
  const producer = kafka.producer();
  await producer.connect();
  
  const requestId = `req-${Date.now()}`;
  await producer.send({
    topic: DEMO_TOPICS.agentRequests,
    messages: [{
      key: requestId,
      value: JSON.stringify({
        request_id: requestId,
        task: 'Analyze the code in src/kafka/client.ts',
        files: ['src/kafka/client.ts'],
        priority: 'normal',
      }),
    }],
  });
  
  await producer.disconnect();
}

async function testAgentResponses() {
  const producer = kafka.producer();
  await producer.connect();
  
  const requestId = `req-${Date.now()}`;
  await producer.send({
    topic: DEMO_TOPICS.agentResponses,
    messages: [{
      key: requestId,
      value: JSON.stringify({
        request_id: requestId,
        status: 'completed',
        result: 'Analysis complete',
        tokens_used: 150,
      }),
    }],
  });
  
  await producer.disconnect();
}

async function testOpencodePrompts() {
  const producer = kafka.producer();
  await producer.connect();
  
  await producer.send({
    topic: DEMO_TOPICS.prompts,
    messages: [{
      key: 'e2e-test-prompt',
      value: JSON.stringify({
        task_id: 'e2e-test-prompt',
        type: 'code_review',
        payload: { repo: 'test-repo', files: ['test.ts'] },
      }),
    }],
  });
  
  await producer.disconnect();
}

async function testOpencodeResponses() {
  const producer = kafka.producer();
  await producer.connect();
  
  await producer.send({
    topic: DEMO_TOPICS.responses,
    messages: [{
      key: 'e2e-test-response',
      value: JSON.stringify({
        task_id: 'e2e-test-response',
        status: 'completed',
        result: 'Review complete',
      }),
    }],
  });
  
  await producer.disconnect();
}

async function testDlq() {
  const producer = kafka.producer();
  await producer.connect();
  
  await producer.send({
    topic: DEMO_TOPICS.dlq,
    messages: [{
      key: 'e2e-test-dlq',
      value: JSON.stringify({
        original_topic: 'opencode.pompts',
        error: 'Test error for DLQ',
        timestamp: new Date().toISOString(),
      }),
    }],
  });
  
  await producer.disconnect();
}

async function testBrokerConnectivity() {
  const admin = kafka.admin();
  await admin.connect();
  
  // List topics as a connectivity test
  const topics = await admin.listTopics();
  if (!topics || topics.length === 0) {
    throw new Error('Could not list topics - connection issue');
  }
  
  await admin.disconnect();
}

async function testListTopics() {
  const admin = kafka.admin();
  await admin.connect();
  
  const topics = await admin.listTopics();
  
  const requiredTopics = Object.values(DEMO_TOPICS);
  const missingTopics = requiredTopics.filter(t => !topics.includes(t));
  
  if (missingTopics.length > 0) {
    throw new Error(`Missing topics: ${missingTopics.join(', ')}`);
  }
  
  await admin.disconnect();
}

async function main() {
  console.log('===========================================');
  console.log('  Kafka E2E Demo Test');
  console.log('===========================================');
  console.log(`Brokers: ${BROKERS.join(', ')}`);
  console.log('');
  
  // Test connectivity first
  await runTest('Broker connectivity', testBrokerConnectivity);
  await runTest('List topics', testListTopics);
  
  // Test healthcheck topic
  await runTest('Healthcheck producer', testHealthcheckProducer);
  await runTest('Healthcheck consumer', testHealthcheckConsumer);
  
  // Test agent request/response topics
  await runTest('Agent requests producer', testAgentRequests);
  await runTest('Agent responses producer', testAgentResponses);
  
  // Test opencode topics
  await runTest('OpenCode prompts producer', testOpencodePrompts);
  await runTest('OpenCode responses producer', testOpencodeResponses);
  
  // Test DLQ
  await runTest('DLQ producer', testDlq);
  
  console.log('');
  console.log('===========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('===========================================');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});