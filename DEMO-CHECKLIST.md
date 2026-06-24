# Демонстрация OpenCode Plugin Kafka

## Статус: ✅ ГОТОВО К ДЕМО

---

## Предварительная проверка (Pre-Demo Checklist)

### 1. Сервисы запущены
```bash
# Должны быть запущены:
docker ps --filter "name=opencode" --format "table {{.Names}}\t{{.Status}}"

# Ожидаемый вывод:
# opencode-kafka     Up X minutes (healthy/unhealthy) - Ports: 9092,9093,9095
# opencode-kafka-ui Up X seconds                      - Ports: 8090
```

### 2. Порты открыты
```bash
# Проверка всех портов
nc -z localhost 9092 && echo "✓ PLAINTEXT: 9092"
nc -z localhost 9093 && echo "✓ PLAINTEXT: 9093"
nc -z localhost 9095 && echo "✓ SSL: 9095"
nc -z localhost 8090 && echo "✓ Kafka UI: 8090"
```

---

## Быстрая демонстрация (5 минут)

### Демо 1: PLAINTEXT подключение
```bash
cd ~/workspase/projects/opencode-plugin-kafka
node scripts/demo-simple.mjs
```

### Демо 2: SSL подключение
```bash
cd ~/workspase/projects/opencode-plugin-kafka
node scripts/demo-ssl.mjs --ssl
```

### Демо 3: E2E Flow
```bash
cd ~/workspase/projects/opencode-plugin-kafka
npm run demo:e2e
```

---

## Kafka UI (веб-интерфейс)

### Доступ
- **URL**: http://localhost:8090
- **Cluster**: local
- **Version**: Apache Kafka 3.8-IV0

### Что можно посмотреть
1. **Topics** — список всех топиков
2. **Consumers** — группы потребителей
3. **Brokers** — информация о брокерах
4. **Schema Registry** — схемы сообщений (если настроено)

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenCode Agent                          │
│                        (Port 8089)                          │
└────────────────────┬────────────────────────────────────────┘
                     │ SDK
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              opencode-plugin-kafka                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Config Parser (kafka-router.json)                   │  │
│  │  - topics: [...]                                     │  │
│  │  - rules: [...]                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Kafka Consumer                                      │  │
│  │  - Group: opencode-plugin-kafka                      │  │
│  │  - Topics: opencode.prompts, demo.*                  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  OpenCodeAgentAdapter                                │  │
│  │  - SDK Client (session.prompt)                       │  │
│  │  - Response polling                                  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Kafka Producer                                      │  │
│  │  - Response Topic: opencode.responses               │  │
│  │  - DLQ Topic: opencode.dlq                          │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │ PLAINTEXT (9092/9093) / SSL (9095)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Apache Kafka KRaft Mode                         │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐    │
│  │  PLAINTEXT    │ │  PLAINTEXT    │ │     SSL       │    │
│  │  Internal     │ │  External     │ │   External    │    │
│  │  :9092        │ │  :9093        │ │   :9095       │    │
│  └───────────────┘ └───────────────┘ └───────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Топики

### Системные топики
| Топик | Описание | Partition | Replication |
|-------|----------|-----------|-------------|
| `opencode.prompts` | Входящие запросы от агента | 1 | 1 |
| `opencode.responses` | Ответы агента | 1 | 1 |
| `opencode.dlq` | Dead Letter Queue (ошибки) | 1 | 1 |

### Демо топики
| Топик | Описание | Partition | Replication |
|-------|----------|-----------|-------------|
| `demo.agent-requests` | Тестовые запросы | 1 | 1 |
| `demo.agent-responses` | Тестовые ответы | 1 | 1 |
| `demo.healthcheck` | Проверка здоровья | 1 | 1 |
| `demo.test` | Тестовый топик | 1 | 1 |

---

## SSL Configuration

### Сертификаты
```
kafka-ssl/
├── ca.pem           # CA Certificate
├── ca-key.pem       # CA Private Key
├── server.pem       # Server Certificate
├── server-key.pem   # Server Private Key
├── client.pem       # Client Certificate
├── client-key.pem   # Client Private Key
├── kafka.keystore.jks   # Kafka Broker Keystore
├── kafka.truststore.jks # Kafka Broker Truststore
└── client.p12       # Client PKCS12
```

### Переменные окружения для SSL
```bash
export KAFKA_BROKERS=localhost:9095
export KAFKA_CLIENT_ID=opencode-plugin-kafka
export KAFKA_GROUP_ID=opencode-plugin-kafka
export KAFKA_SSL=true
export KAFKA_SSL_CA=./kafka-ssl/ca.pem
export KAFKA_SSL_CERT=./kafka-ssl/client.pem
export KAFKA_SSL_KEY=./kafka-ssl/client-key.pem
```

---

## Troubleshooting

### Kafka не запускается
```bash
# Перезапустить Kafka
docker stop opencode-kafka
docker rm opencode-kafka
cd ~/workspase/projects/opencode-plugin-kafka
docker compose -f docker-compose.kafka.yml up -d kafka

# Подождать 60 секунд для инициализации
sleep 60
```

### Kafka UI не открывается
```bash
# Перезапустить Kafka UI
docker stop opencode-kafka-ui
docker start opencode-kafka-ui
# Подождать 15 секунд
sleep 15
curl http://localhost:8090/api/clusters
```

### SSL подключение не работает
```bash
# Проверить что SSL listener активен
docker logs opencode-kafka 2>&1 | grep "Awaiting socket connections"
# Должно показать 9095

# Проверить сертификаты
openssl s_client -connect localhost:9095 -CAfile kafka-ssl/ca.pem
```

### Tests fail
```bash
# Unit тесты (не требуют Kafka)
npm test

# E2E тесты (требуют реальный Kafka)
npm run test:e2e
```

---

## Контакты для поддержки

- **Разработчик**: opencode-plugin-kafka team
- **Версия**: 0.0.1
- **Kafka**: Apache Kafka 3.8-IV0
- **Kafkajs**: v2.0.0

---

## Слайды для руководства

### Слайд 1: Что это?
**OpenCode Plugin Kafka** — плагин для интеграции OpenCode агента с Apache Kafka.

### Слайд 2: Зачем?
- Агент читает сообщения из Kafka топиков
- Обрабатывает запросы через LLM
- Отправляет ответы обратно в Kafka

### Слайд 3: Как работает?
```
Kafka → Consumer → OpenCodeAgentAdapter → SDK → Agent
                                                    ↓
Kafka ← Producer ← Response ← opencode.responses ←──┘
```

### Слайд 4: Production ready
- ✅ SSL/TLS поддержка
- ✅ SASL authentication
- ✅ Dead Letter Queue
- ✅ Configurable timeouts
- ✅ Concurrent request handling

### Слайд 5: Демо
- Показать Kafka UI (localhost:8090)
- Запустить demo-simple.mjs
- Запустить demo-ssl.mjs --ssl
- Показать код plugin