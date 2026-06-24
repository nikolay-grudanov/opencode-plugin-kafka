#!/bin/bash
# consume-test.sh — получать сообщения из Kafka топика

TOPIC="${1:-demo.orders}"
GROUP="${2:-demo-consumer}"
TIMEOUT="${3:-10}"

cd /home/gna/workspase/projects/opencode-plugin-kafka

echo "Listening to $TOPIC (timeout: ${TIMEOUT}s, group: $GROUP)..."

timeout "$TIMEOUT" node -e "
const { Kafka } = require('kafkajs');
const kafka = new Kafka({ clientId: 'demo-consumer', brokers: ['localhost:9093'] });
const consumer = kafka.consumer({ groupId: '$GROUP' });

(async () => {
  await consumer.connect();
  await consumer.subscribe({ topic: '$TOPIC', fromBeginning: true });
  
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log('📥 [' + topic + '/' + partition + '] ' + message.value.toString());
    }
  });
  
  setTimeout(() => {
    console.log('Timeout reached');
    process.exit(0);
  }, $TIMEOUT * 1000);
})();
"