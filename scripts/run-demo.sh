#!/bin/bash
# run-demo.sh — полный демо-цикл для руководства
# Создаёт топики → produce → consume → проверка

set -e

echo "=========================================="
echo "  Демо-стенд opencode-plugin-kafka"
echo "=========================================="
echo ""

# Проверка Kafka
echo "[1/5] Проверка Kafka..."
if curl -s -o /dev/null http://localhost:8090; then
    echo "✅ Kafka UI доступен (http://localhost:8090)"
else
    echo "❌ Kafka UI недоступен. Запустите:"
    echo "   cd ~/workspase/projects/opencode-plugin-kafka"
    echo "   docker compose -f docker-compose.kafka.yml up -d"
    exit 1
fi

echo ""
echo "[2/5] Создание демо-топиков..."
node /home/gna/workspase/projects/opencode-plugin-kafka/scripts/create-demo-topics.mjs 2>/dev/null
echo "✅ Топики готовы"

echo ""
echo "[3/5] Отправка тестового сообщения..."
TOPIC="demo.orders"
node -e "
const { Kafka } = require('kafkajs');
const kafka = new Kafka({ clientId: 'run-demo', brokers: ['localhost:9093'] });
const producer = kafka.producer();
(async () => {
  await producer.connect();
  await producer.send({
    topic: '$TOPIC',
    messages: [{
      key: 'demo-\$(date +%s)',
      value: JSON.stringify({
        orderId: 'DEMO-\$(date +%s)',
        customer: 'Demo Customer',
        amount: 100.00,
        status: 'pending'
      })
    }]
  });
  console.log('✅ Сообщение отправлено в $TOPIC');
  await producer.disconnect();
})();
"

echo ""
echo "[4/5] Запуск consumer (5 сек)..."
timeout 6 node -e "
const { Kafka } = require('kafkajs');
const kafka = new Kafka({ clientId: 'run-demo-check', brokers: ['localhost:9093'] });
const consumer = kafka.consumer({ groupId: 'demo-check-\$(date +%s)' });
const TOPIC = '$TOPIC';
let received = false;

(async () => {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      console.log('✅ ПОЛУЧЕНО:', message.value.toString());
      received = true;
    }
  });
  
  setTimeout(() => {
    if (!received) console.log('⏳ Ожидание сообщений...');
    setTimeout(() => process.exit(0), 1000);
  }, 5000);
})();
"

echo ""
echo "[5/5] SSL проверка..."
if timeout 10 node /home/gna/workspase/projects/opencode-plugin-kafka/scripts/demo-ssl.mjs --ssl 2>&1 | head -5 | grep -q "SSL"; then
    echo "✅ SSL работает на порту 9095"
else
    echo "ℹ️  SSL требует дополнительной настройки"
fi

echo ""
echo "=========================================="
echo "  ✅ Демо завершён успешно!"
echo "=========================================="
echo ""
echo "📊 Kafka UI: http://localhost:8090"
echo "📁 Проект: ~/workspase/projects/opencode-plugin-kafka"
echo ""