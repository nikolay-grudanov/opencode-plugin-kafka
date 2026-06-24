// Simple test to run the plugin with mock context
import { Kafka } from 'kafkajs';
import { createOpencodeClient } from '@opencode-ai/sdk';

const kafka = new Kafka({
  clientId: 'plugin-tester',
  brokers: ['localhost:9093'],
});

async function test() {
  // Create OpenCode client
  const client = createOpencodeClient({
    directory: process.cwd(),
    baseUrl: 'http://localhost:8089'
  });

  console.log('OpenCode client created');
  console.log('Session API:', Object.keys(client.session));

  // Create a test session
  const session = await client.session.create({ body: { title: 'kafka-plugin-test' } });
  console.log('Session created:', session.data?.id);

  // Send a message to opencode.prompts
  const producer = kafka.producer();
  await producer.connect();

  const msgResult = await producer.send({
    topic: 'opencode.prompts',
    messages: [{
      key: 'test-key',
      value: JSON.stringify({ prompt: 'Скажи "Привет от Kafka плагина!"', taskId: 'test-001' })
    }]
  });

  console.log('Message sent to Kafka:', msgResult[0].topicName, 'partition:', msgResult[0].partition, 'offset:', msgResult[0].baseOffset);

  // Wait a bit and check for messages in opencode.responses
  await new Promise(r => setTimeout(r, 3000));

  const consumer = kafka.consumer({ groupId: 'test-group-' + Date.now() });
  await consumer.connect();
  await consumer.subscribe({ topic: 'opencode.responses', fromBeginning: false });

  const messages = [];
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      messages.push({
        key: message.key?.toString(),
        value: message.value?.toString(),
        offset: message.offset
      });
    }
  });

  await new Promise(r => setTimeout(r, 2000));
  await consumer.disconnect();
  await producer.disconnect();

  console.log('Received messages:', messages.length);
  if (messages.length > 0) {
    console.log('First message:', messages[0].value?.substring(0, 200));
  }
}

test().catch(console.error);