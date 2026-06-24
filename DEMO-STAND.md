# Демо-стенд opencode-plugin-kafka

Руководство для быстрого запуска демонстрации плагина Kafka для руководства.

## 🚀 Быстрый старт (5 минут)

### 1. Запуск Kafka (если не запущен)

```bash
cd /home/gna/workspase/projects/opencode-plugin-kafka
docker compose -f docker-compose.kafka.yml up -d
```

Статус проверьте: `docker ps | grep kafka`

### 2. Доступ к сервисам

| Сервис | URL | Описание |
|--------|-----|----------|
| **Kafka UI** | http://localhost:8090 | Управление топиками и сообщениями |
| **Kafka (PLAINTEXT)** | localhost:9092 | Стандартный plaintext |
| **Kafka (SASL)** | localhost:9093 | SASL аутентификация |
| **Kafka (SSL)** | localhost:9095 | SSL/TLS шифрование |

### 3. Запуск демо-скриптов

```bash
# Простой демо (produce → consume цикл)
npm run demo

# Полный E2E демо
node scripts/demo-full.mjs

# SSL демо
node scripts/demo-ssl.mjs --ssl
```

---

## 📋 Топики для демонстрации

Уже созданы и заполнены тестовыми данными:

### Бизнес-топики
- `demo.orders` — 20 заказов (5 партиций)
- `demo.shipments` — 15 доставок (3 партиции)  
- `demo.notifications` — 18 уведомлений (2 партиции)
- `demo.feedback` — 20 отзывов (2 партиции)

### Agent-топики
- `demo.agent-tasks` — задачи для агента (3 партиции)
- `demo.agent-results` — результаты от агента (3 партиции)

---

## 🛠 Bash скрипты для демо

### produce-test-message.sh — Отправить сообщение

```bash
#!/bin/bash
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
    messages: [{ key: 'test', value: '$MESSAGE' }]
  });
  console.log('✅ Message sent to $TOPIC');
  await producer.disconnect();
})();
"
```

### consume-test.sh — Получить сообщения

```bash
#!/bin/bash
TOPIC="${1:-demo.orders}"
GROUP="${2:-demo-consumer}"

cd /home/gna/workspase/projects/opencode-plugin-kafka

node -e "
const { Kafka } = require('kafkajs');
const kafka = new Kafka({ clientId: 'demo-consumer', brokers: ['localhost:9093'] });
const consumer = kafka.consumer({ groupId: '$GROUP' });

(async () => {
  await consumer.connect();
  await consumer.subscribe({ topic: '$TOPIC', fromBeginning: true });
  
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log('📥 [' + topic + '/' + partition + ']', message.value.toString());
    }
  });
})();
"
```

### run-demo.sh — Полный демо-цикл

```bash
#!/bin/bash
# Запускает полный демо-цикл: создание топиков → produce → consume → проверка

echo "=== Демо-стенд Kafka Plugin ==="
echo ""

echo "[1/4] Проверка Kafka..."
curl -s -o /dev/null http://localhost:8090 && echo "✅ Kafka UI доступен" || echo "❌ Запустите Kafka"

echo ""
echo "[2/4] Создание демо-топиков..."
node /home/gna/workspase/projects/opencode-plugin-kafka/scripts/create-demo-topics.mjs

echo ""
echo "[3/4] Отправка тестовых сообщений..."
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
      key: 'demo-001',
      value: JSON.stringify({ orderId: 'DEMO-001', customer: 'Demo Customer', amount: 100.00, status: 'pending' })
    }]
  });
  console.log('✅ Сообщение отправлено');
  await producer.disconnect();
})();
"

echo ""
echo "[4/4] Запуск consumer (5 секунд)..."
timeout 5 node -e "
const { Kafka } = require('kafkajs');
const kafka = new Kafka({ clientId: 'run-demo-check', brokers: ['localhost:9093'] });
const consumer = kafka.consumer({ groupId: 'demo-check' });
(async () => {
  await consumer.connect();
  await consumer.subscribe({ topic: '$TOPIC', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      console.log('✅ ПОЛУЧЕНО:', message.value.toString());
    }
  });
  setTimeout(() => process.exit(0), 5000);
})();
"

echo ""
echo "=== Демо завершён! ==="
```

### Сделайте скрипты исполняемыми:

```bash
chmod +x /home/gna/workspase/projects/opencode-plugin-kafka/scripts/produce-test-message.sh
chmod +x /home/gna/workspase/projects/opencode-plugin-kafka/scripts/consume-test.sh
chmod +x /home/gna/workspase/projects/opencode-plugin-kafka/scripts/run-demo.sh
```

---

## 🔐 SSL подключение

### Проверка SSL

```bash
node scripts/demo-ssl.mjs --ssl
```

### Подключение через SSL

```bash
export KAFKA_BROKERS=localhost:9095
export KAFKA_CLIENT_ID=my-ssl-client
export KAFKA_GROUP_ID=my-ssl-group
export KAFKA_SSL=true
```

Сертификаты в: `./kafka-ssl/`
- CA: `ca.pem`
- Cert: `client.pem`
- Key: `client-key.pem`

---

## 📊 Мониторинг

### Через Kafka UI

1. Откройте http://localhost:8090
2. Выберите топик → Messages
3. Просмотр сообщений в реальном времени

### Через командную строку

```bash
# Лист топиков
docker exec opencode-kafka rpk topic list

# Описания топика
docker exec opencode-kafka rpk topic describe demo.orders
```

---

## ⚠️ Устранение проблем

| Проблема | Решение |
|----------|---------|
| Kafka не запускается | `docker compose -f docker-compose.kafka.yml restart` |
| Нет доступа к UI | Проверьте порт 8090: `docker ps \| grep kafka-ui` |
| SSL ошибки | Проверьте сертификаты в `./kafka-ssl/` |
| topics не существуют | Запустите `node scripts/create-demo-topics.mjs` |

---

## 📞 Контакты

**opencode-plugin-kafka**: ~/workspase/projects/opencode-plugin-kafka/