#!/bin/bash
# produce-test-message.sh — отправить тестовое сообщение в Kafka топик

TOPIC="${1:-demo.orders}"
MESSAGE="${2:-{\"orderId\":\"TEST-001\",\"customer\":\"Demo User\",\"amount\":99.99,\"status\":\"pending\"}}"

cd /home/gna/workspase/projects/opencode-plugin-kafka

node -e "
const { Kafka } = require('kafkajs');
const kafka = new Kafka({ clientId: 'demo-producer', brokers: ['localhost:9093'] });
const producer = kafka.producer();

(async () => {
  await producer.connect();
  await producer.send({
    topic: '$TOPIC',
    messages: [{ key: 'test-\$(date +%s)', value: '$MESSAGE' }]
  });
  console.log('✅ Message sent to $TOPIC: $MESSAGE');
  await producer.disconnect();
})();
"