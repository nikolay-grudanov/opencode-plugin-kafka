#!/bin/bash
# Скрипт создания демо-топиков в Kafka
# Использует SSL подключение

set -e

BOOTSTRAP_SERVERS="${BOOTSTRAP_SERVERS:-localhost:9093}"
SSL_CONFIG="--command-config /dev/stdin <<<'
security.protocol=SSL
ssl.truststore.location=$(pwd)/kafka-ssl/kafka.truststore.jks
ssl.truststore.password=changeit
ssl.keystore.location=$(pwd)/kafka-ssl/kafka.keystore.jks
ssl.keystore.password=changeit
'"

# Альтернативный способ через временный файл
SSL_CONFIG_FILE="/tmp/kafka-ssl-client.properties"

cat > $SSL_CONFIG_FILE << EOF
security.protocol=SSL
ssl.truststore.location=/home/gna/workspase/projects/opencode-plugin-kafka/kafka-ssl/kafka.truststore.jks
ssl.truststore.password=changeit
ssl.keystore.location=/home/gna/workspase/projects/opencode-plugin-kafka/kafka-ssl/kafka.keystore.jks
ssl.keystore.password=changeit
ssl.key.password=changeit
EOF

KAFKA_BIN="/opt/kafka/bin"

echo "=== Создание демо-топиков ==="
echo "Bootstrap servers: $BOOTSTRAP_SERVERS"

# Демо-топики для плагина
TOPICS=(
    "opencode.prompts:2:1"          # Основной топик для промптов
    "opencode.responses:2:1"        # Ответы от агента
    "opencode.errors:1:1"           # Ошибки обработки
    "opencode.dlq:1:1"            # Dead Letter Queue
)

for topic_spec in "${TOPICS[@]}"; do
    topic="${topic_spec%%:*}"
    replicas="${topic_spec##*:}"
    partitions=$(echo $topic_spec | cut -d: -f2)
    
    echo "Создаём топик: $topic (partitions=$partitions, replicas=$replicas)"
    
    $KAFKA_BIN/kafka-topics.sh \
        --create \
        --topic "$topic" \
        --bootstrap-server "$BOOTSTRAP_SERVERS" \
        --command-config $SSL_CONFIG_FILE \
        --partitions $partitions \
        --replication-factor $replicas \
        2>&1 || echo "Топик $topic уже существует"
done

echo ""
echo "=== Список топиков ==="
$KAFKA_BIN/kafka-topics.sh \
    --list \
    --bootstrap-server "$BOOTSTRAP_SERVERS" \
    --command-config $SSL_CONFIG_FILE

echo ""
echo "=== Готово ==="
echo "Kafka доступен по: $BOOTSTRAP_SERVERS"
echo "Kafka UI доступен по: http://localhost:8080"