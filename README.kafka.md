# Kafka SSL Integration

Руководство по настройке SSL/TLS для opencode-plugin-kafka.

## Быстрый старт

### 1. plaintext (без SSL)

```bash
export KAFKA_BROKERS=localhost:9092
export KAFKA_CLIENT_ID=my-client
export KAFKA_GROUP_ID=my-group
# KAFKA_SSL по умолчанию = false
```

### 2. SSL с TLS

```bash
export KAFKA_BROKERS=localhost:9093
export KAFKA_CLIENT_ID=my-client
export KAFKA_GROUP_ID=my-group
export KAFKA_SSL=true
```

### 3. SSL с клиентскими сертификатами

```bash
export KAFKA_BROKERS=localhost:9093
export KAFKA_CLIENT_ID=my-client
export KAFKA_GROUP_ID=my-group
export KAFKA_SSL=true

# Keystore для клиентского сертификата
export KAFKA_SSL_KEYSTORE_PATH=./kafka-ssl/kafka.keystore.jks
export KAFKA_SSL_KEYSTORE_PASSWORD=changeit

# Truststore для CA сертификатов
export KAFKA_SSL_TRUSTSTORE_PATH=./kafka-ssl/kafka.truststore.jks
export KAFKA_SSL_TRUSTSTORE_PASSWORD=changeit
```

## Переменные окружения

| Переменная | Описание | По умолчанию |
|-----------|----------|-------------|
| `KAFKA_BROKERS` | Список брокеров через запятую | (обязательно) |
| `KAFKA_CLIENT_ID` | Идентификатор клиента | (обязательно) |
| `KAFKA_GROUP_ID` | Группа потребителей | (обязательно) |
| `KAFKA_SSL` | Включить SSL | `false` |
| `KAFKA_SSL_KEYSTORE_PATH` | Путь к JKS keystore | - |
| `KAFKA_SSL_KEYSTORE_PASSWORD` | Пароль keystore | - |
| `KAFKA_SSL_TRUSTSTORE_PATH` | Путь к JKS truststore | - |
| `KAFKA_SSL_TRUSTSTORE_PASSWORD` | Пароль truststore | - |
| `KAFKA_USERNAME` | SASL username | - |
| `KAFKA_PASSWORD` | SASL password | - |
| `KAFKA_SASL_MECHANISM` | SASL mechanism | `plain` |
| `KAFKA_DLQ_TOPIC` | DLQ топик | - |

## Генерация сертификатов

### Использование скрипта

```bash
cd kafka-ssl
./generate-certs.sh
```

Скрипт создаст:
- `kafka.keystore.jks` - клиентский keystore
- `kafka.truststore.jks` - truststore с CA
- `ca-cert` / `ca-key` - CA сертификаты
- `kafka-broker-signed.crt` - подписанный брокером сертификат

### Требования

- OpenSSL
- keytool (Java)
- cfssl (опционально)

## Конфигурация Kafka брокера

### Docker/Podman с SSL

```bash
# Создание контейнера с SSL
podman run -d --name redpanda-ssl \
  -p 9093:9093 \
  -p 9094:9094 \
  -e KAFKA_CFG_SSL_KEYSTORE_PATH=/etc/redpanda/certs/kafka.keystore.jks \
  -e KAFKA_CFG_SSL_KEYSTORE_PASSWORD=changeit \
  -e KAFKA_CFG_SSL_TRUSTSTORE_PATH=/etc/redpanda/certs/kafka.truststore.jks \
  -e KAFKA_CFG_SSL_TRUSTSTORE_PASSWORD=changeit \
  docker.redpanda.com/redpandadata/redpanda:latest
```

## Проверка SSL

### Тест демо-скриптом

```bash
# Сборка
npm run build

# Запуск демо
node scripts/demo-ssl.mjs --ssl
```

### Ручной тест

```bash
# Создание тестовых топиков
podman exec redpanda rpk topic create demo-input demo-response demo-input-dlq

# Проверка подключения
node -e "
const { createKafkaClient } = require('./dist/src/kafka/client.js');
process.env.KAFKA_BROKERS = 'localhost:9093';
process.env.KAFKA_CLIENT_ID = 'test-client';
process.env.KAFKA_GROUP_ID = 'test-group';
process.env.KAFKA_SSL = 'true';
const { kafka } = createKafkaClient(process.env);
kafka.producer().then(p => p.connect().then(() => console.log('Connected!')).catch(e => console.error(e)));
"
```

## Troubleshooting

### Ошибка: "certificate unknown"

```bash
# Проверьте truststore
keytool -list -keystore kafka-ssl/kafka.truststore.jks -storepass changeit
```

### Ошибка: "no cipher suites"

```bash
# Проверьте поддерживаемые cipher suites
openssl ciphers -s | head -5
# Обновите JDK если старый
```

### Ошибка: "unable to find valid certification path"

```bash
# Импортируйте CA в truststore
keytool -importcert -alias ca -file ca-cert -keystore kafka-ssl/kafka.truststore.jks -storepass changeit
```

## Ссылки

- [KafkaJS SSL Configuration](https://kafka.js.org/docs/configuration#ssl)
- [Redpanda SSL](https://docs.redpanda.com/current/security/tls/)
- [Java KeyStore](https://docs.oracle.com/cd/E19836-01/estug_81746/estug_81746.pdf)