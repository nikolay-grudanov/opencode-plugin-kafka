// Full E2E Demo Script
// Demonstrates: produce → consume → process → verify response/DLQ

import { Kafka } from 'kafkajs';

const TOPICS = {
  INPUT: 'demo-input',
  RESPONSE: 'demo-response',
  DLQ: 'demo-input-dlq',
};

const CONFIG = {
  clientId: 'demo-full-client',
  groupId: 'demo-full-group',
  brokers: ['localhost:9092'],
};

// Simulated agent (MockOpenCodeAgent behavior)
class MockAgent {
  async invoke({ prompt, timeoutMs }) {
    const start = Date.now();
    
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const duration = Date.now() - start;
    
    // Simple responses for demo
    let response = 'Processed';
    
    if (prompt?.includes('2+2') || prompt?.includes('2 2')) {
      response = '4';
    } else if (prompt?.includes('capital') && prompt?.includes('France')) {
      response = 'Paris';
    } else if (prompt?.includes('Hello')) {
      response = 'Hello back!';
    }
    
    return {
      sessionId: `ses_${Date.now()}`,
      response,
      status: 'success',
      executionTimeMs: duration,
    };
  }
}

async function createTopics(kafka) {
  const admin = kafka.admin();
  await admin.connect();
  
  const existingTopics = await admin.listTopics();
  const topicsToCreate = Object.values(TOPICS).filter(t => !existingTopics.includes(t));
  
  if (topicsToCreate.length > 0) {
    await admin.createTopics({
      topics: topicsToCreate.map(topic => ({ topic, numPartitions: 1 })),
    });
  }
  
  await admin.disconnect();
}

async function sendTestMessage(producer) {
  const message = {
    task: 'What is 2+2? Answer briefly.',
    correlationId: 'demo-full-001',
  };
  
  await producer.send({
    topic: TOPICS.INPUT,
    messages: [{ key: 'demo-key', value: JSON.stringify(message) }],
  });
  
  console.log(`✅ Message sent to ${TOPICS.INPUT}:`, JSON.stringify(message, null, 2));
}

async function consumeAndProcess() {
  const agent = new MockAgent();
  
  const kafka = new Kafka(CONFIG);
  const consumer = kafka.consumer({ groupId: CONFIG.groupId });
  const dlqProducer = kafka.producer();
  const responseProducer = kafka.producer();
  
  await Promise.all([
    consumer.connect(),
    dlqProducer.connect(),
    responseProducer.connect(),
  ]);
  
  await consumer.subscribe({ topic: TOPICS.INPUT, fromBeginning: true });
  
  return new Promise((resolve) => {
    let processed = false;
    
    consumer.run({
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        if (processed) return;
        processed = true;
        
        console.log('\n[Step 5] Processing message...');
        
        try {
          // Step 1: Parse JSON
          const value = message.value?.toString();
          const payload = JSON.parse(value);
          console.log(`  → Payload parsed: ${JSON.stringify(payload)}`);
          
          // Step 2: Match rule (simulated)
          const matched = payload.task ? { name: 'demo-rule', jsonPath: '$.task' } : null;
          
          if (!matched) {
            console.log('  → No rule matched, skipping');
            resolve({ success: 0, error: 0, dlq: 0 });
            return;
          }
          
          console.log(`  → Rule matched: ${matched.name} (jsonPath: ${matched.jsonPath})`);
          
          // Step 3: Build prompt
          const prompt = payload.task;
          console.log(`  → Prompt built: ${prompt}`);
          
          // Step 4: Call agent
          console.log(`  → Calling demo-agent (timeout: 30000ms)`);
          const startTime = Date.now();
          
          const result = await agent.invoke({ prompt, timeoutMs: 30000 });
          
          const executionTime = Date.now() - startTime;
          console.log(`  → Agent responded: "${result.response}" (in ${executionTime}ms)`);
          
          // Step 5: Send response
          if (TOPICS.RESPONSE) {
            await responseProducer.send({
              topic: TOPICS.RESPONSE,
              messages: [{
                key: result.sessionId,
                value: JSON.stringify({
                  correlationId: payload.correlationId,
                  sessionId: result.sessionId,
                  ruleName: matched.name,
                  agentId: 'demo-agent',
                  response: result.response,
                  status: result.status,
                  executionTimeMs: executionTime,
                  timestamp: new Date().toISOString(),
                }),
              }],
            });
            console.log(`  → Response sent to ${TOPICS.RESPONSE}`);
          }
          
          resolve({ success: 1, error: 0, dlq: 0 });
          
        } catch (error) {
          console.error('  → Error:', error.message);
          
          // Send to DLQ
          await dlqProducer.send({
            topic: TOPICS.DLQ,
            messages: [{
              value: JSON.stringify({
                originalValue: message.value?.toString(),
                errorMessage: error.message,
                topic: TOPICS.INPUT,
                failedAt: new Date().toISOString(),
              }),
            }],
          });
          
          resolve({ success: 0, error: 1, dlq: 1 });
        }
      },
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!processed) {
        resolve({ success: 0, error: 0, dlq: 0 });
      }
    }, 10000);
  });
}

async function verifyResponse(kafka) {
  const consumer = kafka.consumer({ groupId: `${CONFIG.groupId}-verify` });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.RESPONSE, fromBeginning: true });
  
  return new Promise((resolve) => {
    let found = false;
    
    consumer.run({
      eachMessage: async ({ message }) => {
        if (found) return;
        found = true;
        
        const value = message.value?.toString();
        console.log('\n[Step 6] Verifying response...');
        console.log('✅ Response received:', value);
        
        await consumer.disconnect();
        resolve(JSON.parse(value));
      },
    });
    
    setTimeout(async () => {
      if (!found) {
        console.log('\n[Step 6] No response found (timeout)');
        await consumer.disconnect();
        resolve(null);
      }
    }, 5000);
  });
}

async function main() {
  const startTime = Date.now();
  let results = { success: 0, error: 0, dlq: 0 };
  
  console.log('========================================');
  console.log('FULL E2E DEMO - opencode-plugin-kafka');
  console.log('========================================');
  
  try {
    // Step 1: Connect to Kafka
    console.log('\n[Step 1] Starting Kafka...');
    const kafka = new Kafka(CONFIG);
    const initialConn = await kafka.admin().connect();
    console.log(`✅ Kafka ready (${CONFIG.brokers.join(', ')})`);
    await initialConn.disconnect();
    
    // Step 2: Create topics
    console.log('\n[Step 2] Creating topics...');
    await createTopics(kafka);
    console.log('✅ Topics created:');
    console.log(`  - ${TOPICS.INPUT} (input)`);
    console.log(`  - ${TOPICS.RESPONSE} (responses)`);
    console.log(`  - ${TOPICS.DLQ} (DLQ)`);
    
    // Step 3: Send test message
    console.log('\n[Step 3] Sending test message...');
    const producer = kafka.producer();
    await producer.connect();
    await sendTestMessage(producer);
    
    // Step 4: Start consumer
    console.log('\n[Step 4] Starting consumer (5s)...');
    await new Promise(r => setTimeout(r, 1000));
    
    // Step 5: Consume and process
    results = await consumeAndProcess();
    await new Promise(r => setTimeout(r, 1000));
    
    // Step 6: Verify response
    const response = await verifyResponse(kafka);
    
    // Step 7: Cleanup
    console.log('\n[Step 7] Cleanup...');
    await producer.disconnect();
    
    // Summary
    const duration = (Date.now() - startTime) / 1000;
    
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Total messages sent:     ${1}`);
    console.log(`Messages processed:    ${results.success + results.error}`);
    console.log(`Successes:            ${results.success}`);
    console.log(`Errors:              ${results.error}`);
    console.log(`DLQ messages:         ${results.dlq}`);
    console.log(`Duration:            ${duration.toFixed(1)}s`);
    console.log('========================================');
    
    console.log('\n✅ Demo completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
  }
}

main();