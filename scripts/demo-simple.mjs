// Простой демо скрипт для проверки Kafka
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'demo-client',
  brokers: ['localhost:9093'], // External PLAINTEXT (9092 only works inside container)
});

async function demo() {
  const producer = kafka.producer();
  await producer.connect();
  console.log('✅ Producer подключен к Kafka');
  
  // Отправить сообщение
  await producer.send({
    topic: 'opencode.prompts',
    messages: [{
      key: 'demo-001',
      value: JSON.stringify({
        task_id: 'demo-001',
        type: 'code_review',
        payload: { repo: 'opencode-plugin-kafka', files: ['src/kafka/client.ts'] }
      })
    }]
  });
  console.log('✅ Сообщение отправлено в opencode.prompts');
  
  // Прочитать сообщения
  const consumer = kafka.consumer({ groupId: 'demo-group' });
  await consumer.connect();
  await consumer.subscribe({ topic: 'opencode.prompts', fromBeginning: true });
  
  const messages = [];
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const value = message.value?.toString();
      if (value) messages.push(JSON.parse(value));
    }
  });
  
  // Подождать немного
  await new Promise(r => setTimeout(r, 2000));
  await consumer.disconnect();
  
  console.log(`✅ Прочитано ${messages.length} сообщений из opencode.prompts`);
  console.log('Сообщения:', messages.map(m => m.task_id).join(', '));
  
  await producer.disconnect();
  console.log('✅ Демо завершено успешно!');
}

demo().catch(console.error);
