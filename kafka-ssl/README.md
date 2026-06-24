# Kafka SSL Setup для opencode-plugin-kafka

## Содержание

- `kafka-ssl/` — SSL сертификаты и скрипты
- `docker-compose.kafka.yml` — Compose файл с Kafka + Kafka UI

## Быстрый старт

### 1. Генерация сертификатов

```bash
cd /home/gna/workspase/projects/opencode-plugin-kafka
./kafka-ssl/generate-certs.sh
```

### 2. Запуск Kafka

```bash
docker compose -f docker-compose.kafka.yml up -d
```

Ожидание готовности: ~30-60 секунд

### 3. Проверка

```bash
# Kafka UI: http://localhost:8080
# Kafka SSL: localhost:9093
# Kafka PLAINTEXT: localhost:9092
```

## Топики

- `opencode.prompts` — основной топик для промптов
- `opencode.responses` — ответы от агента
- `opencode.errors` — ошибки обработки
- `opencode.dlq` — Dead Letter Queue

## SSL Configuration для клиентов

```properties
security.protocol=SSL
ssl.truststore.location=kafka-ssl/kafka.truststore.jks
ssl.truststore.password=changeit
ssl.keystore.location=kafka-ssl/kafka.keystore.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
```

## Переменные окружения

```bash
source .env.kafka
```

## Остановка

```bash
docker compose -f docker-compose.kafka.yml down
```

## Troubleshooting

### Kafka не запускается
- Проверьте ресурсы: `podman stats`
- Увеличьте memory в docker-compose.yml

### SSL ошибки
- Проверьте сертификаты: `keytool -list -keystore kafka-ssl/kafka.keystore.jks`